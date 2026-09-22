import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  categories,
  courts,
  matches,
  participants,
  registrations,
  tournaments,
  users,
  type Court,
  type Match,
} from '@/lib/db/schema'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { createBrackets } from '@/lib/services/brackets'
import { recordResult } from '@/lib/services/matches'
import { assertManualSchedule, replanPendingMatches } from '@/lib/services/scheduling'
import { cancelCategory, lockTeams, saveTeams } from '@/lib/services/teams'
import { createTournament, updateTournament } from '@/lib/services/tournaments'

type CategoryName = 'men' | 'women' | 'mixed'

interface SeedParticipant {
  id: string
  name: string
  gender: 'man' | 'woman'
  level?: number
}

interface SeedTeam {
  name: string
  participants: SeedParticipant[]
}

interface SeedCategory {
  category: CategoryName
  teams: SeedTeam[]
}

function simpleCategory(category: CategoryName): SeedCategory {
  const participants: SeedParticipant[] =
    category === 'mixed'
      ? [
          { id: 'mixed-participant-1', name: 'Mixto 1', gender: 'man' },
          { id: 'mixed-participant-2', name: 'Mixta 2', gender: 'woman' },
          { id: 'mixed-participant-3', name: 'Mixto 3', gender: 'man' },
          { id: 'mixed-participant-4', name: 'Mixta 4', gender: 'woman' },
        ]
      : Array.from({ length: 4 }, (_, index): SeedParticipant => ({
          id: `${category}-participant-${index + 1}`,
          name: `${category} ${index + 1}`,
          gender: category === 'women' ? 'woman' : 'man',
        }))
  return {
    category,
    teams: [
      { name: `${category} pareja 1`, participants: participants.slice(0, 2) },
      { name: `${category} pareja 2`, participants: participants.slice(2, 4) },
    ],
  }
}

function fourTeamCategory(category: CategoryName): SeedCategory {
  const participants: SeedParticipant[] = Array.from({ length: 8 }, (_, index): SeedParticipant => ({
    id: `${category}-participant-${index + 1}`,
    name: `${category} ${index + 1}`,
    gender: category === 'women' ? 'woman' : 'man',
  }))
  return {
    category,
    teams: Array.from({ length: 4 }, (_, index) => ({
      name: `${category} pareja ${index + 1}`,
      participants: participants.slice(index * 2, index * 2 + 2),
    })),
  }
}

describe('scheduling service', () => {
  let tournamentId = ''
  let tournamentCourts: Court[] = []

  beforeEach(async () => {
    await db.insert(users).values({
      id: 'organizer-id',
      username: 'organizador1',
      passwordHash: 'test-hash',
      role: 'organizer',
      state: 'active',
    })
  })

  afterEach(resetDatabase)

  async function seedTournament(configs: SeedCategory[]): Promise<Map<CategoryName, string>> {
    const tournament = await createTournament(makeTournamentInput())
    tournamentId = tournament.id
    tournamentCourts = [...tournament.courts].sort((left, right) => left.position - right.position)

    const participantMap = new Map<string, SeedParticipant>()
    for (const config of configs) {
      for (const team of config.teams) {
        for (const participant of team.participants) participantMap.set(participant.id, participant)
      }
    }
    await db.insert(participants).values(
      [...participantMap.values()].map((participant) => ({
        id: participant.id,
        tournamentId,
        name: participant.name,
        gender: participant.gender,
        level: participant.level ?? 3,
      })),
    )

    const categoryRows = await db.select().from(categories).where(eq(categories.tournamentId, tournamentId))
    const categoryIds = new Map<CategoryName, string>()
    for (const config of configs) {
      const categoryId = categoryRows.find((row) => row.category === config.category)!.id
      categoryIds.set(config.category, categoryId)
      const registered = config.teams.flatMap((team) => team.participants)
      await db.insert(registrations).values(
        registered.map((participant) => ({
          id: `registration-${participant.id}-${config.category}`,
          participantId: participant.id,
          categoryId,
        })),
      )
      await saveTeams(
        categoryId,
        config.teams.map((team) => ({ memberIds: team.participants.map((participant) => participant.id), name: team.name })),
        1,
      )
    }

    const unusedCategoryIds = categoryRows
      .filter((row) => !categoryIds.has(row.category))
      .map((row) => row.id)
    await Promise.all(unusedCategoryIds.map((categoryId) => cancelCategory(categoryId, 1)))
    await lockTeams(tournamentId)
    return categoryIds
  }

  async function matchByStage(categoryId: string, stage: string): Promise<Match> {
    const [row] = await db
      .select()
      .from(matches)
      .where(and(eq(matches.categoryId, categoryId), eq(matches.stage, stage)))
      .limit(1)
    if (!row) throw new Error(`Missing ${stage} match`)
    return row
  }

  async function matchById(matchId: string): Promise<Match> {
    const [row] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1)
    if (!row) throw new Error(`Missing match ${matchId}`)
    return row
  }

  it('assigns a court and start time to first-round matches when brackets are created', async () => {
    const categoryIds = await seedTournament([simpleCategory('men'), simpleCategory('women'), simpleCategory('mixed')])

    await createBrackets(tournamentId)

    for (const category of ['men', 'women', 'mixed'] as const) {
      const match = await matchByStage(categoryIds.get(category)!, 'winners-final')
      expect(match.courtId).toEqual(expect.any(String))
      expect(match.scheduledStartAt).toBeInstanceOf(Date)
      expect(match.scheduledEndAt).toBeInstanceOf(Date)
    }

    const enabledCourtIds = new Set(tournamentCourts.filter((court) => court.enabled).map((court) => court.id))
    const matchesWithCourt = (await db.select().from(matches)).filter((match) => match.courtId)
    expect(matchesWithCourt).toHaveLength(3)
    for (const match of matchesWithCourt) expect(enabledCourtIds.has(match.courtId!)).toBe(true)
  })

  it('moves every open match off a disabled court when replanning', async () => {
    await seedTournament([simpleCategory('men'), simpleCategory('women'), simpleCategory('mixed')])
    await createBrackets(tournamentId)

    const uncoveredCourt = tournamentCourts.find((court) => !court.covered)!
    const before = (await db.select().from(matches)).filter((match) => match.courtId === uncoveredCourt.id)
    expect(before).toHaveLength(1)

    await db.update(courts).set({ enabled: false }).where(eq(courts.id, uncoveredCourt.id))
    await replanPendingMatches(tournamentId, new Date())

    const openMatches = (await db.select().from(matches)).filter((match) =>
      ['pending', 'scheduled'].includes(match.state),
    )
    expect(openMatches.filter((match) => match.courtId)).toHaveLength(3)
    for (const match of openMatches) expect(match.courtId).not.toBe(uncoveredCourt.id)
  })

  it('does not reschedule in-progress or completed matches', async () => {
    const categoryIds = await seedTournament([simpleCategory('men'), simpleCategory('women'), simpleCategory('mixed')])
    await createBrackets(tournamentId)

    const menMatch = await matchByStage(categoryIds.get('men')!, 'winners-final')
    const womenMatch = await matchByStage(categoryIds.get('women')!, 'winners-final')
    expect(menMatch.courtId).toEqual(expect.any(String))
    expect(menMatch.scheduledStartAt).toBeInstanceOf(Date)
    expect(womenMatch.courtId).toEqual(expect.any(String))
    expect(womenMatch.scheduledStartAt).toBeInstanceOf(Date)
    await db.update(matches).set({ state: 'in_progress' }).where(eq(matches.id, menMatch.id))
    await db.update(matches).set({ state: 'completed' }).where(eq(matches.id, womenMatch.id))

    const replanFrom = new Date('2026-10-04T08:00:00.000Z')
    await replanPendingMatches(tournamentId, replanFrom)

    await expect(matchById(menMatch.id)).resolves.toMatchObject({
      state: 'in_progress',
      courtId: menMatch.courtId,
      scheduledStartAt: menMatch.scheduledStartAt,
    })
    await expect(matchById(womenMatch.id)).resolves.toMatchObject({
      state: 'completed',
      courtId: womenMatch.courtId,
      scheduledStartAt: womenMatch.scheduledStartAt,
    })

    const mixedMatch = await matchByStage(categoryIds.get('mixed')!, 'winners-final')
    expect(mixedMatch.scheduledStartAt?.getTime()).toBe(replanFrom.getTime())
  })

  it('replans through updateTournament when the uncovered court is disabled', async () => {
    await seedTournament([simpleCategory('men'), simpleCategory('women'), simpleCategory('mixed')])
    await createBrackets(tournamentId)

    const uncoveredCourt = tournamentCourts.find((court) => !court.covered)!
    const before = (await db.select().from(matches)).filter((match) => match.courtId === uncoveredCourt.id)
    expect(before).toHaveLength(1)

    const [current] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
    await updateTournament({ id: tournamentId, version: current!.version, courtCount: 2 })

    const openMatches = (await db.select().from(matches)).filter((match) =>
      ['pending', 'scheduled'].includes(match.state),
    )
    expect(openMatches.filter((match) => match.courtId)).toHaveLength(3)
    for (const match of openMatches) expect(match.courtId).not.toBe(uncoveredCourt.id)
  })

  it('prioritizes the dependent final whose source finished earlier', async () => {
    const categoryIds = await seedTournament([fourTeamCategory('men'), fourTeamCategory('women')])
    await db.update(courts).set({ enabled: false }).where(eq(courts.position, 2))
    await db.update(courts).set({ enabled: false }).where(eq(courts.position, 3))
    await createBrackets(tournamentId)

    const roundOne = async (category: CategoryName) =>
      db
        .select()
        .from(matches)
        .where(and(eq(matches.categoryId, categoryIds.get(category)!), eq(matches.stage, 'winners-round'), eq(matches.round, 1)))
        .orderBy(asc(matches.position))

    for (const [category, end] of [
      ['women', '2026-10-04T08:40:00.000Z'],
      ['men', '2026-10-04T10:40:00.000Z'],
    ] as const) {
      for (const row of await roundOne(category)) {
        await recordResult({ matchId: row.id, version: row.version, sets: [{ home: 9, away: 7 }] })
        await db.update(matches).set({ actualEndAt: new Date(end) }).where(eq(matches.id, row.id))
      }
    }

    const menFinal = await matchByStage(categoryIds.get('men')!, 'winners-final')
    const womenFinal = await matchByStage(categoryIds.get('women')!, 'winners-final')
    await db
      .update(matches)
      .set({ state: 'scheduled', courtId: null, scheduledStartAt: null, scheduledEndAt: null })
      .where(and(eq(matches.categoryId, categoryIds.get('men')!), eq(matches.stage, 'winners-final')))
    await db
      .update(matches)
      .set({ state: 'scheduled', courtId: null, scheduledStartAt: null, scheduledEndAt: null })
      .where(and(eq(matches.categoryId, categoryIds.get('women')!), eq(matches.stage, 'winners-final')))

    await replanPendingMatches(tournamentId, new Date('2026-10-04T07:00:00.000Z'))

    const men = await matchById(menFinal.id)
    const women = await matchById(womenFinal.id)
    expect(men.state).toBe('scheduled')
    expect(women.state).toBe('scheduled')
    expect(women.scheduledStartAt!.getTime()).toBeLessThan(men.scheduledStartAt!.getTime())
  })

  it('blocks a delayed in-progress match until its real duration is covered', async () => {
    const categoryIds = await seedTournament([simpleCategory('men'), simpleCategory('women')])
    await db.update(courts).set({ enabled: false }).where(eq(courts.position, 2))
    await db.update(courts).set({ enabled: false }).where(eq(courts.position, 3))
    await createBrackets(tournamentId)

    const menMatch = await matchByStage(categoryIds.get('men')!, 'winners-final')
    const womenMatch = await matchByStage(categoryIds.get('women')!, 'winners-final')
    const staleStart = new Date('2026-10-04T09:00:00.000Z')
    const lateStart = new Date('2026-10-04T09:35:00.000Z')
    await db
      .update(matches)
      .set({
        state: 'in_progress',
        actualStartAt: lateStart,
        scheduledStartAt: staleStart,
        scheduledEndAt: new Date(staleStart.getTime() + 90 * 60_000),
      })
      .where(eq(matches.id, menMatch.id))
    await db
      .update(matches)
      .set({ state: 'scheduled', courtId: null, scheduledStartAt: null, scheduledEndAt: null })
      .where(eq(matches.id, womenMatch.id))

    const replanFrom = new Date('2026-10-04T10:00:00.000Z')
    await replanPendingMatches(tournamentId, replanFrom)

    const women = await matchById(womenMatch.id)
    expect(women.scheduledStartAt!.getTime()).toBeGreaterThanOrEqual(lateStart.getTime() + 90 * 60_000)
  })

  it('keeps the conditional reset reservation while the grand final is in progress', async () => {
    const categoryIds = await seedTournament([simpleCategory('men'), simpleCategory('women'), simpleCategory('mixed')])
    await createBrackets(tournamentId)

    const grandFinal = await matchByStage(categoryIds.get('men')!, 'grand-final')
    const actualStart = new Date('2026-10-04T09:35:00.000Z')
    await db
      .update(matches)
      .set({ state: 'in_progress', actualStartAt: actualStart, scheduledStartAt: null, scheduledEndAt: null, courtId: null })
      .where(eq(matches.id, grandFinal.id))

    await replanPendingMatches(tournamentId, new Date('2026-10-04T08:00:00.000Z'))

    const reset = await matchByStage(categoryIds.get('men')!, 'grand-final-reset')
    expect(reset.state).toBe('cancelled')
    expect(reset.resultReason).toBe('conditional-reset')
    expect(reset.courtId).toEqual(expect.any(String))
    expect(reset.scheduledStartAt!.getTime()).toBeGreaterThanOrEqual(actualStart.getTime() + 90 * 60_000 + 20 * 60_000)
  })

  it('rejects a manual schedule that overlaps another match on the same court', async () => {    const categoryIds = await seedTournament([simpleCategory('men'), simpleCategory('women')])
    await createBrackets(tournamentId)

    const menMatch = await matchByStage(categoryIds.get('men')!, 'winners-final')
    const womenMatch = await matchByStage(categoryIds.get('women')!, 'winners-final')
    const startsAt = new Date('2026-10-04T10:00:00.000Z')
    await db
      .update(matches)
      .set({
        courtId: menMatch.courtId,
        scheduledStartAt: startsAt,
        scheduledEndAt: new Date(startsAt.getTime() + 40 * 60_000),
      })
      .where(eq(matches.id, menMatch.id))

    await expect(
      assertManualSchedule({
        matchId: womenMatch.id,
        courtId: menMatch.courtId!,
        startsAt: new Date(startsAt.getTime() + 10 * 60_000),
        endsAt: new Date(startsAt.getTime() + 50 * 60_000),
        tournamentId,
      }),
    ).rejects.toThrow('La cancha ya esta ocupada en ese horario')
  })

  it('rejects a manual schedule that violates the minimum rest for a shared participant', async () => {
    const categoryIds = await seedTournament([
      {
        category: 'men',
        teams: [
          {
            name: 'Masculino 1',
            participants: [
              { id: 'shared-player', name: 'Jugador compartido', gender: 'man' },
              { id: 'men-player-2', name: 'Masculino 2', gender: 'man' },
            ],
          },
          {
            name: 'Masculino 3',
            participants: [
              { id: 'men-player-3', name: 'Masculino 3', gender: 'man' },
              { id: 'men-player-4', name: 'Masculino 4', gender: 'man' },
            ],
          },
        ],
      },
      {
        category: 'mixed',
        teams: [
          {
            name: 'Mixto 1',
            participants: [
              { id: 'shared-player', name: 'Jugador compartido', gender: 'man' },
              { id: 'mixed-player-2', name: 'Mixta 2', gender: 'woman' },
            ],
          },
          {
            name: 'Mixto 3',
            participants: [
              { id: 'mixed-player-3', name: 'Mixto 3', gender: 'man' },
              { id: 'mixed-player-4', name: 'Mixta 4', gender: 'woman' },
            ],
          },
        ],
      },
    ])
    await createBrackets(tournamentId)

    const menMatch = await matchByStage(categoryIds.get('men')!, 'winners-final')
    const mixedMatch = await matchByStage(categoryIds.get('mixed')!, 'winners-final')
    const startsAt = new Date('2026-10-04T10:00:00.000Z')
    await db
      .update(matches)
      .set({ scheduledStartAt: startsAt, scheduledEndAt: new Date(startsAt.getTime() + 40 * 60_000) })
      .where(eq(matches.id, menMatch.id))

    await expect(
      assertManualSchedule({
        matchId: mixedMatch.id,
        courtId: tournamentCourts[1]!.id,
        startsAt: new Date(startsAt.getTime() + 50 * 60_000),
        endsAt: new Date(startsAt.getTime() + 90 * 60_000),
        tournamentId,
      }),
    ).rejects.toThrow('No se respeta el descanso minimo')
  })
})
