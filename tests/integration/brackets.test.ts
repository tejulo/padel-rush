import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
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
  users,
} from '@/lib/db/schema'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { createBrackets } from '@/lib/services/brackets'
import { createTournament } from '@/lib/services/tournaments'

describe('bracket persistence', () => {
  let tournamentId = ''
  let categoryId = ''

  beforeEach(async () => {
    await db.insert(users).values({
      id: 'organizer-id',
      username: 'organizador1',
      passwordHash: 'test-hash',
      role: 'organizer',
      state: 'active',
    })
    const tournament = await createTournament(makeTournamentInput())
    tournamentId = tournament.id
    const categoryRows = await db
      .select()
      .from(categories)
      .where(eq(categories.tournamentId, tournamentId))
      .orderBy(asc(categories.category))
    categoryId = categoryRows[0]!.id
    await db
      .update(categories)
      .set({ state: 'cancelled', version: 2 })
      .where(and(eq(categories.tournamentId, tournamentId), eq(categories.id, categoryRows[1]!.id)))
    await db
      .update(categories)
      .set({ state: 'cancelled', version: 2 })
      .where(and(eq(categories.tournamentId, tournamentId), eq(categories.id, categoryRows[2]!.id)))

    const participantRows = await db
      .insert(participants)
      .values(
        Array.from({ length: 8 }, (_, index) => ({
          id: `participant-${index + 1}`,
          tournamentId,
          name: `Jugador ${index + 1}`,
          gender: 'man' as const,
          level: 3,
        })),
      )
      .returning()
    await db.insert(registrations).values(
      participantRows.map((participant) => ({
        id: `registration-${participant.id}`,
        participantId: participant.id,
        categoryId,
      })),
    )
    const teamRows = await db
      .insert(teams)
      .values(
        Array.from({ length: 4 }, (_, index) => ({
          id: `team-${index + 1}`,
          categoryId,
          name: `Pareja ${index + 1}`,
          levelTotal: 6,
          locked: true,
          lockedAt: new Date(),
        })),
      )
      .returning()
    await db.insert(teamMembers).values(
      teamRows.flatMap((team, index) =>
        participantRows.slice(index * 2, index * 2 + 2).map((participant) => ({
          id: `member-${team.id}-${participant.id}`,
          teamId: team.id,
          participantId: participant.id,
          categoryId,
        })),
      ),
    )
    await db.update(categories).set({ state: 'locked' }).where(eq(categories.id, categoryId))
  })

  afterEach(resetDatabase)

  it('persists the complete topology, activation marker, token, and state transition', async () => {
    await expect(createBrackets(tournamentId)).resolves.toBeUndefined()

    const tournamentRows = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
    expect(tournamentRows[0]).toMatchObject({ state: 'in_progress' })
    expect(tournamentRows[0]?.publicToken).toEqual(expect.any(String))

    const matchRows = await db
      .select()
      .from(matches)
      .where(eq(matches.categoryId, categoryId))
      .orderBy(asc(matches.round), asc(matches.position))
    expect(matchRows).toHaveLength(7)
    expect(matchRows.filter((match) => match.state === 'cancelled')).toHaveLength(1)

    const reset = matchRows.find((match) => match.stage === 'grand-final-reset')!
    expect(reset).toMatchObject({ format: 'best-of-three', state: 'cancelled', resultReason: 'conditional-reset' })

    const firstRound = matchRows.find((match) => match.stage === 'winners-round' && match.round === 1 && match.position === 1)!
    const losersRound = matchRows.find((match) => match.stage === 'losers-round' && match.round === 1 && match.position === 1)!
    const firstRoundSlots = await db.select().from(matchSlots).where(eq(matchSlots.matchId, firstRound.id))
    const losersRoundSlots = await db.select().from(matchSlots).where(eq(matchSlots.matchId, losersRound.id))
    expect(firstRoundSlots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 'a', teamId: 'team-1', sourceMatchId: null, sourceOutcome: null }),
        expect.objectContaining({ slot: 'b', teamId: 'team-2', sourceMatchId: null, sourceOutcome: null }),
      ]),
    )
    expect(losersRoundSlots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 'a', sourceMatchId: firstRound.id, sourceOutcome: 'loser' }),
      ]),
    )
    const resetSlots = await db.select().from(matchSlots).where(eq(matchSlots.matchId, reset.id))
    expect(resetSlots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 'a', sourceMatchId: expect.any(String), sourceOutcome: 'winner' }),
        expect.objectContaining({ slot: 'b', sourceMatchId: expect.any(String), sourceOutcome: 'loser' }),
      ]),
    )
  })

  it('rejects an unlocked active category without changing tournament state', async () => {
    await db.update(teams).set({ locked: false, lockedAt: null }).where(eq(teams.categoryId, categoryId))

    await expect(createBrackets(tournamentId)).rejects.toThrow('bloqueados')
    await expect(db.select({ state: tournaments.state }).from(tournaments).where(eq(tournaments.id, tournamentId))).resolves.toEqual([
      { state: 'draft' },
    ])
    await expect(db.select().from(matches).where(eq(matches.categoryId, categoryId))).resolves.toHaveLength(0)
  })
})
