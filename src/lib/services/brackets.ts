import { randomBytes, randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  categories,
  matchSlots,
  matches,
  participants,
  registrations,
  teamMembers,
  teams,
  tournaments,
} from '@/lib/db/schema'
import { validateCategoryTeams, type PairingParticipant, type TeamProposal } from '@/lib/domain/pairing'
import { buildBracket, type BracketMatch } from '@/lib/domain/bracket'
import { lockTournamentForWrite, type TournamentTransaction } from '@/lib/services/tournaments'
import { replanPendingMatches } from '@/lib/services/scheduling'

type TeamDatabase = TournamentTransaction

interface CategoryBracketData {
  categoryId: string
  teamIds: string[]
  matches: BracketMatch[]
}

async function lockedCategoryTeams(tx: TeamDatabase, categoryId: string) {
  const teamRows = await tx
    .select()
    .from(teams)
    .where(eq(teams.categoryId, categoryId))
    .orderBy(asc(teams.name), asc(teams.id))
    .for('update')
  const memberRows = await tx
    .select({
      teamId: teamMembers.teamId,
      participantId: participants.id,
      name: participants.name,
      gender: participants.gender,
      level: participants.level,
    })
    .from(teamMembers)
    .innerJoin(participants, eq(teamMembers.participantId, participants.id))
    .where(eq(teamMembers.categoryId, categoryId))
    .orderBy(asc(teamMembers.teamId), asc(teamMembers.id))
  const registeredRows = await tx
    .select({ id: participants.id })
    .from(registrations)
    .innerJoin(participants, eq(registrations.participantId, participants.id))
    .where(eq(registrations.categoryId, categoryId))
    .orderBy(asc(participants.id))

  const proposals: TeamProposal[] = teamRows.map((team) => {
    const members: PairingParticipant[] = memberRows
      .filter((member) => member.teamId === team.id)
      .map(({ participantId, name, gender, level }) => ({ id: participantId, name, gender, level }))
    return {
      memberIds: members.map((member) => member.id),
      members,
      levelTotal: team.levelTotal,
    }
  })

  return { teamRows, proposals, registeredParticipantIds: registeredRows.map((row) => row.id) }
}

function assertValidCategoryTeams(
  category: { category: 'men' | 'women' | 'mixed' },
  teamRows: Awaited<ReturnType<typeof lockedCategoryTeams>>['teamRows'],
  proposals: TeamProposal[],
  registeredParticipantIds: string[],
): void {
  if (teamRows.some((team) => !team.locked)) throw new Error('Los equipos deben estar bloqueados')
  const validation = validateCategoryTeams(category.category, proposals, registeredParticipantIds)
  if (!validation.ok) throw new Error(validation.message)
}

async function prepareCategoryBracket(tx: TeamDatabase, category: (typeof categories.$inferSelect)): Promise<CategoryBracketData> {
  const { teamRows, proposals, registeredParticipantIds } = await lockedCategoryTeams(tx, category.id)
  assertValidCategoryTeams(category, teamRows, proposals, registeredParticipantIds)
  return {
    categoryId: category.id,
    teamIds: teamRows.map((team) => team.id),
    matches: buildBracket({ categoryId: category.id, teamIds: teamRows.map((team) => team.id) }),
  }
}

async function persistCategoryBracket(tx: TeamDatabase, bracket: CategoryBracketData): Promise<void> {
  const idsByKey = new Map(bracket.matches.map((match) => [match.key, randomUUID()]))
  await tx.insert(matches).values(
    bracket.matches.map((match) => ({
      id: idsByKey.get(match.key)!,
      categoryId: bracket.categoryId,
      stage: match.stage,
      round: match.round,
      position: match.position,
      format: match.format,
      state: match.state,
      resultReason: match.resultReason ?? null,
    })),
  )

  await tx.insert(matchSlots).values(
    bracket.matches.flatMap((match) =>
      (['a', 'b'] as const).map((slot) => {
        const bracketSlot = match.slots[slot]
        return {
          id: randomUUID(),
          matchId: idsByKey.get(match.key)!,
          slot,
          teamId: bracketSlot.teamId ?? null,
          sourceMatchId: bracketSlot.source ? idsByKey.get(bracketSlot.source.key)! : null,
          sourceOutcome: bracketSlot.source?.outcome ?? null,
        }
      }),
    ),
  )
}

export async function createBrackets(tournamentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { tournament, tournamentCategories } = await lockTournamentForWrite(tx, tournamentId)
    const activeCategories = tournamentCategories.filter((category) => category.state !== 'cancelled')
    if (activeCategories.length === 0) throw new Error('No hay categorias activas')
    if (tournament.state !== 'draft') throw new Error('El torneo no admite cambios')

    const prepared = [] as CategoryBracketData[]
    for (const category of activeCategories) {
      if (category.state !== 'locked') throw new Error('Los equipos deben estar bloqueados')
      prepared.push(await prepareCategoryBracket(tx, category))
    }

    for (const bracket of prepared) await persistCategoryBracket(tx, bracket)

    const now = new Date()
    for (const category of activeCategories) {
      await tx
        .update(categories)
        .set({ state: 'in_progress', version: sql<number>`${categories.version} + 1`, updatedAt: now })
        .where(and(eq(categories.id, category.id), eq(categories.state, 'locked')))
    }

    await tx
      .update(tournaments)
      .set({
        state: 'in_progress',
        publicToken: tournament.publicToken || randomBytes(32).toString('base64url'),
        version: sql<number>`${tournaments.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(tournaments.id, tournament.id), eq(tournaments.version, tournament.version)))
  })

  await replanPendingMatches(tournamentId, new Date())
}
