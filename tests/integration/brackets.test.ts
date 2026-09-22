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
  let womenCategoryId = ''

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
    categoryId = categoryRows.find((category) => category.category === 'men')!.id
    womenCategoryId = categoryRows.find((category) => category.category === 'women')!.id
    for (const category of categoryRows.filter((row) => row.id !== categoryId)) {
      await db
        .update(categories)
        .set({ state: 'cancelled', version: 2 })
        .where(and(eq(categories.tournamentId, tournamentId), eq(categories.id, category.id)))
    }

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

  async function seedLockedWomenCategory(): Promise<void> {
    const participantRows = await db
      .insert(participants)
      .values(
        Array.from({ length: 8 }, (_, index) => ({
          id: `women-participant-${index + 1}`,
          tournamentId,
          name: `Jugadora ${index + 1}`,
          gender: 'woman' as const,
          level: 3,
        })),
      )
      .returning()
    await db.insert(registrations).values(
      participantRows.map((participant) => ({
        id: `registration-${participant.id}`,
        participantId: participant.id,
        categoryId: womenCategoryId,
      })),
    )
    const teamRows = await db
      .insert(teams)
      .values(
        Array.from({ length: 4 }, (_, index) => ({
          id: `women-team-${index + 1}`,
          categoryId: womenCategoryId,
          name: `Pareja femenina ${index + 1}`,
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
          categoryId: womenCategoryId,
        })),
      ),
    )
    await db.update(categories).set({ state: 'locked' }).where(eq(categories.id, womenCategoryId))
  }

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
    expect(reset).toMatchObject({ profile: 'finals', state: 'cancelled', resultReason: 'conditional-reset' })

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

  it('rejects an invalid category that was not canceled', async () => {
    const mixedCategory = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.tournamentId, tournamentId), eq(categories.category, 'mixed')))
    await db.update(categories).set({ state: 'locked' }).where(eq(categories.id, mixedCategory[0]!.id))

    await expect(createBrackets(tournamentId)).rejects.toThrow('al menos dos equipos')
    await expect(db.select().from(matches).where(eq(matches.categoryId, categoryId))).resolves.toHaveLength(0)
    await expect(
      db.select({ state: tournaments.state }).from(tournaments).where(eq(tournaments.id, tournamentId)),
    ).resolves.toEqual([
      { state: 'draft' },
    ])
  })

  it('refuses to create brackets when every category is canceled', async () => {
    await db.update(categories).set({ state: 'cancelled' }).where(eq(categories.tournamentId, tournamentId))

    await expect(createBrackets(tournamentId)).rejects.toThrow('No hay categorias activas')
    await expect(db.select().from(matches).where(eq(matches.categoryId, categoryId))).resolves.toHaveLength(0)
    await expect(
      db.select({ state: tournaments.state }).from(tournaments).where(eq(tournaments.id, tournamentId)),
    ).resolves.toEqual([
      { state: 'draft' },
    ])
  })

  it('preserves an existing public token', async () => {
    await db.update(tournaments).set({ publicToken: 'existing-public-token' }).where(eq(tournaments.id, tournamentId))

    await expect(createBrackets(tournamentId)).resolves.toBeUndefined()
    await expect(
      db.select({ publicToken: tournaments.publicToken }).from(tournaments).where(eq(tournaments.id, tournamentId)),
    ).resolves.toEqual([{ publicToken: 'existing-public-token' }])
  })

  it('creates brackets for multiple active categories in one transaction', async () => {
    await seedLockedWomenCategory()

    await expect(createBrackets(tournamentId)).resolves.toBeUndefined()
    await expect(db.select().from(matches).where(eq(matches.categoryId, categoryId))).resolves.toHaveLength(7)
    await expect(db.select().from(matches).where(eq(matches.categoryId, womenCategoryId))).resolves.toHaveLength(7)
    await expect(
      db
        .select({ categoryId: categories.id, state: categories.state })
        .from(categories)
        .where(eq(categories.tournamentId, tournamentId)),
    ).resolves.toEqual(
      expect.arrayContaining([
        { categoryId, state: 'in_progress' },
        { categoryId: womenCategoryId, state: 'in_progress' },
      ]),
    )
  })

  it('rolls back earlier category brackets when later persistence fails', async () => {
    await seedLockedWomenCategory()
    await db.insert(matches).values({
      id: 'existing-women-match',
      categoryId: womenCategoryId,
      stage: 'winners-round',
      round: 1,
      position: 1,
      profile: 'regular',
      state: 'pending',
    })

    await expect(createBrackets(tournamentId)).rejects.toThrow()
    await expect(db.select().from(matches).where(eq(matches.categoryId, categoryId))).resolves.toHaveLength(0)
    await expect(db.select().from(matches).where(eq(matches.categoryId, womenCategoryId))).resolves.toEqual([
      expect.objectContaining({ id: 'existing-women-match' }),
    ])
    await expect(
      db.select({ state: tournaments.state }).from(tournaments).where(eq(tournaments.id, tournamentId)),
    ).resolves.toEqual([
      { state: 'draft' },
    ])
    await expect(
      db
        .select({ categoryId: categories.id, state: categories.state })
        .from(categories)
        .where(eq(categories.tournamentId, tournamentId)),
    ).resolves.toEqual(
      expect.arrayContaining([
        { categoryId, state: 'locked' },
        { categoryId: womenCategoryId, state: 'locked' },
      ]),
    )
  })
})
