import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  categories,
  matches,
  participants,
  registrations,
  teamMembers,
  teams,
  tournaments,
  type Category as CategoryRow,
  type Team,
} from '@/lib/db/schema'
import {
  validateCategoryTeams,
  type CategoryValidation,
  type PairingParticipant,
  type TeamProposal,
} from '@/lib/domain/pairing'
import { lockTournamentForWrite, type TournamentTransaction } from '@/lib/services/tournaments'

export interface DraftTeamInput {
  memberIds: string[]
  name?: string
}

export type TeamWithMembers = Team & { members: PairingParticipant[] }
export type TournamentCategoryTeams = CategoryRow & { teams: TeamWithMembers[] }
type TeamDatabase = typeof db | TournamentTransaction

function categoryValidationError(validation: CategoryValidation): never {
  if (validation.ok) throw new Error('La categoria es valida')
  throw new Error(validation.message)
}

async function lockedCategory(tx: TournamentTransaction, categoryId: string) {
  const [categoryReference] = await tx
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1)
  if (!categoryReference) throw new Error('Categoria no encontrada')

  const locked = await lockTournamentForWrite(tx, categoryReference.tournamentId)
  const category = locked.tournamentCategories.find((row) => row.id === categoryId)
  if (!category) throw new Error('Categoria no encontrada')
  return { ...locked, category }
}

async function registeredParticipants(tx: TeamDatabase, categoryId: string): Promise<PairingParticipant[]> {
  return tx
    .select({
      id: participants.id,
      name: participants.name,
      gender: participants.gender,
      level: participants.level,
    })
    .from(registrations)
    .innerJoin(participants, eq(registrations.participantId, participants.id))
    .where(eq(registrations.categoryId, categoryId))
    .orderBy(asc(participants.id))
}

async function categoryTeams(tx: TeamDatabase, categoryId: string): Promise<TeamWithMembers[]> {
  const teamRows = await tx
    .select()
    .from(teams)
    .where(eq(teams.categoryId, categoryId))
    .orderBy(asc(teams.name), asc(teams.id))
  const memberRows = await tx
    .select({
      teamId: teamMembers.teamId,
      id: participants.id,
      name: participants.name,
      gender: participants.gender,
      level: participants.level,
    })
    .from(teamMembers)
    .innerJoin(participants, eq(teamMembers.participantId, participants.id))
    .where(eq(teamMembers.categoryId, categoryId))
    .orderBy(asc(teamMembers.teamId), asc(teamMembers.id))

  return teamRows.map((team) => ({
    ...team,
    members: memberRows
      .filter((member) => member.teamId === team.id)
      .map((member) => ({
        id: member.id,
        name: member.name,
        gender: member.gender,
        level: member.level,
      })),
  }))
}

function materializeDraftTeams(
  draftTeams: readonly DraftTeamInput[],
  participantsById: Map<string, PairingParticipant>,
): TeamProposal[] {
  return draftTeams.map((draftTeam) => {
    const members = draftTeam.memberIds.map((participantId) => {
      const participant = participantsById.get(participantId)
      if (!participant) throw new Error('El participante no esta inscripto en la categoria')
      return participant
    })
    return {
      memberIds: members.map((member) => member.id),
      members,
      levelTotal: members.reduce((total, member) => total + member.level, 0),
    }
  })
}

function validateDraftTeamMembers(category: CategoryRow['category'], draftTeams: readonly TeamProposal[]): void {
  const participantIds = new Set<string>()
  for (const team of draftTeams) {
    if (team.memberIds.length !== 2) throw new Error('Cada equipo debe tener exactamente dos participantes')
    for (const participantId of team.memberIds) {
      if (participantIds.has(participantId)) throw new Error('No se puede repetir un participante')
      participantIds.add(participantId)
    }

    const genders = team.members?.map((member) => member.gender) ?? []
    if (category === 'mixed' && genders.length === 2 && !(genders.includes('man') && genders.includes('woman'))) {
      throw new Error('Cada equipo mixto debe tener un hombre y una mujer')
    }
    if (category === 'men' && genders.some((gender) => gender !== 'man')) {
      throw new Error('Los equipos masculinos solo pueden tener hombres')
    }
    if (category === 'women' && genders.some((gender) => gender !== 'woman')) {
      throw new Error('Los equipos femeninos solo pueden tener mujeres')
    }
  }

  const validation = validateCategoryTeams(category, draftTeams.length >= 2 ? draftTeams.slice(0, 2) : draftTeams)
  if (!validation.ok && !validation.message.includes('potencia de dos') && !validation.message.includes('al menos dos')) {
    categoryValidationError(validation)
  }
}

export async function getCategoryParticipants(categoryId: string): Promise<PairingParticipant[]> {
  return registeredParticipants(db, categoryId)
}

export async function getTeams(categoryId: string): Promise<TeamWithMembers[]> {
  return categoryTeams(db, categoryId)
}

export async function getTournamentTeams(tournamentId: string): Promise<TournamentCategoryTeams[]> {
  const tournamentCategories = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId))
    .orderBy(asc(categories.category))

  return Promise.all(
    tournamentCategories.map(async (category) => ({
      ...category,
      teams: await getTeams(category.id),
    })),
  )
}

export async function saveTeams(
  categoryId: string,
  draftTeams: readonly DraftTeamInput[],
  version: number,
): Promise<Team[]> {
  return db.transaction(async (tx) => {
    const { tournament, category } = await lockedCategory(tx, categoryId)
    if (tournament.state !== 'draft' || category.state !== 'draft') {
      throw new Error('La categoria no admite cambios')
    }
    if (!Number.isInteger(version) || version !== category.version) throw new Error('Datos desactualizados')

    const categoryParticipants = await registeredParticipants(tx, categoryId)
    const participantsById = new Map(categoryParticipants.map((participant) => [participant.id, participant]))
    const proposals = materializeDraftTeams(draftTeams, participantsById)
    validateDraftTeamMembers(category.category, proposals)

    await tx.delete(teams).where(eq(teams.categoryId, categoryId))
    const savedTeams = proposals.length
      ? await tx
          .insert(teams)
          .values(
            proposals.map((proposal, index) => ({
              id: randomUUID(),
              categoryId,
              name: draftTeams[index]?.name?.trim() || `Pareja ${index + 1}`,
              levelTotal: proposal.levelTotal,
            })),
          )
          .returning()
      : []

    if (savedTeams.length > 0) {
      await tx.insert(teamMembers).values(
        savedTeams.flatMap((team, index) =>
          proposals[index]!.memberIds.map((participantId) => ({
            id: randomUUID(),
            teamId: team.id,
            participantId,
            categoryId,
          })),
        ),
      )
    }

    const [updatedCategory] = await tx
      .update(categories)
      .set({ version: category.version + 1, updatedAt: new Date() })
      .where(and(eq(categories.id, categoryId), eq(categories.version, version)))
      .returning({ id: categories.id })
    if (!updatedCategory) throw new Error('Datos desactualizados')

    return savedTeams
  })
}

async function validateStoredCategory(
  tx: TournamentTransaction,
  category: CategoryRow,
): Promise<{ teams: TeamWithMembers[]; validation: CategoryValidation }> {
  const storedTeams = await categoryTeams(tx, category.id)
  const proposals = storedTeams.map(({ members, ...team }) => ({
    memberIds: members.map((member) => member.id),
    members,
    levelTotal: team.levelTotal,
  }))
  return { teams: storedTeams, validation: validateCategoryTeams(category.category, proposals) }
}

export async function lockTeams(tournamentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { tournament, tournamentCategories } = await lockTournamentForWrite(tx, tournamentId)
    if (tournament.state !== 'draft') throw new Error('El torneo no admite cambios')

    const activeCategories = tournamentCategories.filter((category) => category.state !== 'cancelled')
    if (activeCategories.length === 0) throw new Error('No hay categorias activas')

    const validCategories: CategoryRow[] = []
    for (const category of activeCategories) {
      if (category.state === 'locked') {
        validCategories.push(category)
        continue
      }
      if (category.state !== 'draft') throw new Error('La categoria no admite cambios')
      const { validation } = await validateStoredCategory(tx, category)
      if (!validation.ok) categoryValidationError(validation)
      validCategories.push(category)
    }

    const lockedAt = new Date()
    for (const category of validCategories) {
      if (category.state === 'locked') continue
      await tx
        .update(teams)
        .set({ locked: true, lockedAt, version: sql<number>`${teams.version} + 1`, updatedAt: lockedAt })
        .where(eq(teams.categoryId, category.id))
      const [updated] = await tx
        .update(categories)
        .set({ state: 'locked', version: category.version + 1, updatedAt: lockedAt })
        .where(and(eq(categories.id, category.id), eq(categories.version, category.version)))
        .returning({ id: categories.id })
      if (!updated) throw new Error('Datos desactualizados')
    }
  })
}

export async function cancelCategory(categoryId: string, version?: number): Promise<void> {
  await db.transaction(async (tx) => {
    const { tournament, category } = await lockedCategory(tx, categoryId)
    if (tournament.state !== 'draft' || category.state !== 'draft') throw new Error('La categoria no admite cambios')
    if (version !== undefined && version !== category.version) throw new Error('Datos desactualizados')
    await tx
      .update(categories)
      .set({ state: 'cancelled', version: category.version + 1, updatedAt: new Date() })
      .where(and(eq(categories.id, category.id), eq(categories.version, category.version)))
  })
}

export async function returnTournamentToDraft(tournamentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { tournament, tournamentCategories } = await lockTournamentForWrite(tx, tournamentId)
    if (tournament.state !== 'in_progress' && tournament.state !== 'draft') {
      throw new Error('El torneo no puede volver a borrador')
    }

    const categoryIds = tournamentCategories.map((category) => category.id)
    if (categoryIds.length > 0) {
      const startedMatches = await tx
        .select({ id: matches.id })
        .from(matches)
        .where(and(inArray(matches.categoryId, categoryIds), inArray(matches.state, ['in_progress', 'completed', 'forfeit'])))
        .limit(1)
      if (startedMatches.length > 0) throw new Error('El torneo ya tiene partidos iniciados')
      await tx.delete(matches).where(and(inArray(matches.categoryId, categoryIds), inArray(matches.state, ['pending', 'scheduled', 'cancelled'])))
      await tx.delete(teams).where(inArray(teams.categoryId, categoryIds))
      await tx
        .update(categories)
        .set({ state: 'draft', version: sql<number>`${categories.version} + 1`, updatedAt: new Date() })
        .where(inArray(categories.id, categoryIds))
    }
    await tx
      .update(tournaments)
      .set({ state: 'draft', version: sql<number>`${tournaments.version} + 1`, updatedAt: new Date() })
      .where(eq(tournaments.id, tournamentId))
  })
}
