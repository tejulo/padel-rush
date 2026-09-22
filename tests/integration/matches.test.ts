import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { requireUser } from '@/lib/auth/guards'
import { recordResultAction } from '@/app/actions/matches'
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
import {
  clearResult,
  listTournamentMatches,
  moveMatch,
  recordForfeit,
  recordResult,
  startMatch,
  substitutePlayer,
} from '@/lib/services/matches'
import { tournamentInstant } from '@/lib/services/scheduling'
import { createTournament } from '@/lib/services/tournaments'

vi.mock('@/lib/auth/guards', () => ({ requireUser: vi.fn(), requireRole: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

describe('match operations', () => {
  let tournamentId = ''
  let categoryId = ''
  let teamIds: string[] = []
  let participantIds: string[] = []
  let enabledCourtId = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetDatabase()
    await db.insert(users).values([
      {
        id: 'organizer-id',
        username: 'organizador1',
        passwordHash: 'test-hash',
        role: 'organizer',
        state: 'active',
      },
      {
        id: 'other-organizer-id',
        username: 'organizador2',
        passwordHash: 'test-hash',
        role: 'organizer',
        state: 'active',
      },
      {
        id: 'admin-id',
        username: 'admin1',
        passwordHash: 'test-hash',
        role: 'admin',
        state: 'active',
      },
    ])
  })

  afterEach(resetDatabase)

  async function seedBracket(teamCount = 2): Promise<void> {
    const tournament = await createTournament(makeTournamentInput())
    tournamentId = tournament.id
    enabledCourtId = tournament.courts.find((court) => court.enabled)!.id
    const categoryRows = await db
      .select()
      .from(categories)
      .where(eq(categories.tournamentId, tournamentId))
      .orderBy(asc(categories.category))
    categoryId = categoryRows.find((category) => category.category === 'men')!.id
    await db
      .update(categories)
      .set({ state: 'cancelled', version: 2 })
      .where(and(eq(categories.tournamentId, tournamentId), inArray(categories.id, categoryRows.filter((row) => row.id !== categoryId).map((row) => row.id))))

    const participantRows = await db
      .insert(participants)
      .values(
        Array.from({ length: teamCount * 2 }, (_, index) => ({
          id: `participant-${index + 1}`,
          tournamentId,
          name: `Jugador ${index + 1}`,
          gender: 'man' as const,
          level: 3,
        })),
      )
      .returning()
    participantIds = participantRows.map((participant) => participant.id)
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
        Array.from({ length: teamCount }, (_, index) => ({
          id: `team-${index + 1}`,
          categoryId,
          name: `Pareja ${index + 1}`,
          levelTotal: 6,
          locked: true,
          lockedAt: new Date(),
        })),
      )
      .returning()
    teamIds = teamRows.map((team) => team.id)
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
    await createBrackets(tournamentId)
  }

  async function match(stage: string, round = 1, position = 1) {
    const [result] = await db
      .select()
      .from(matches)
      .where(and(eq(matches.categoryId, categoryId), eq(matches.stage, stage), eq(matches.round, round), eq(matches.position, position)))
      .limit(1)
    if (!result) throw new Error(`Missing ${stage}-${round}-${position}`)
    return result
  }

  async function schedule(matchId: string): Promise<void> {
    await db.update(matches).set({ state: 'scheduled' }).where(eq(matches.id, matchId))
  }

  async function play(stage: string, round: number, position: number, winner: 'home' | 'away') {
    const row = await match(stage, round, position)
    await schedule(row.id)
    const sets =
      row.profile === 'regular'
        ? [{ home: winner === 'home' ? 9 : 7, away: winner === 'home' ? 7 : 9 }]
        : winner === 'home'
          ? [{ home: 6, away: 4 }, { home: 6, away: 4 }]
          : [{ home: 4, away: 6 }, { home: 4, away: 6 }]
    return recordResult({ matchId: row.id, version: row.version, sets })
  }

  it('advances persisted winner and loser routes and activates the exact reset row', async () => {
    await seedBracket()
    const first = await match('winners-final')
    await schedule(first.id)

    const completedFirst = await recordResult({
      matchId: first.id,
      version: first.version,
      sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }],
    })
    expect(completedFirst.winnerTeamId).toBe(teamIds[0])

    const grandFinal = await match('grand-final')
    expect(await db.select().from(matchSlots).where(eq(matchSlots.matchId, grandFinal.id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 'a', teamId: teamIds[0] }),
        expect.objectContaining({ slot: 'b', teamId: teamIds[1] }),
      ]),
    )
    await schedule(grandFinal.id)
    await recordResult({
      matchId: grandFinal.id,
      version: grandFinal.version,
      sets: [{ home: 4, away: 6 }, { home: 4, away: 6 }],
    })

    const reset = await match('grand-final-reset')
    expect(reset).toMatchObject({ state: 'scheduled', resultReason: null })
    expect(await db.select().from(matchSlots).where(eq(matchSlots.matchId, reset.id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 'a', teamId: teamIds[1] }),
        expect.objectContaining({ slot: 'b', teamId: teamIds[0] }),
      ]),
    )
  })

  it('keeps the conditional reset terminal when the winners champion wins', async () => {
    await seedBracket()
    const first = await match('winners-final')
    await schedule(first.id)
    await recordResult({ matchId: first.id, version: first.version, sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }] })
    const grandFinal = await match('grand-final')
    await schedule(grandFinal.id)
    await recordResult({
      matchId: grandFinal.id,
      version: grandFinal.version,
      sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }],
    })

    await expect(match('grand-final-reset')).resolves.toMatchObject({
      state: 'cancelled',
      resultReason: 'conditional-reset',
    })
    await expect(db.select({ state: tournaments.state }).from(tournaments).where(eq(tournaments.id, tournamentId))).resolves.toEqual([
      { state: 'finished' },
    ])
  })

  it('reverts an activated reset when its grand-final result is cleared', async () => {
    await seedBracket()
    const first = await match('winners-final')
    await schedule(first.id)
    await recordResult({ matchId: first.id, version: first.version, sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }] })
    const grandFinal = await match('grand-final')
    await schedule(grandFinal.id)
    await recordResult({ matchId: grandFinal.id, version: grandFinal.version, sets: [{ home: 4, away: 6 }, { home: 4, away: 6 }] })
    const completedGrandFinal = await match('grand-final')
    const activatedReset = await match('grand-final-reset')

    await expect(clearResult(grandFinal.id, completedGrandFinal.version)).resolves.toBeUndefined()
    await expect(match('grand-final-reset')).resolves.toMatchObject({ state: 'cancelled', resultReason: 'conditional-reset' })
    await expect(match('grand-final')).resolves.toMatchObject({ state: 'scheduled', resultReason: null })
    expect(activatedReset.version).toBeGreaterThan(1)
  })

  it('runs an eight-team losers path through the reset to a finished tournament', async () => {
    await seedBracket(8)
    await play('winners-round', 1, 1, 'home')
    await play('winners-round', 1, 2, 'home')
    await play('winners-round', 1, 3, 'home')
    await play('winners-round', 1, 4, 'home')
    await play('winners-round', 2, 1, 'home')
    await play('winners-round', 2, 2, 'home')
    await play('winners-final', 3, 1, 'home')
    await play('losers-round', 1, 1, 'home')
    await play('losers-round', 1, 2, 'home')
    await play('losers-round', 2, 1, 'home')
    await play('losers-round', 2, 2, 'home')
    await play('losers-round', 3, 1, 'home')
    await play('losers-final', 4, 1, 'home')
    await play('grand-final', 1, 1, 'away')

    const activated = await match('grand-final-reset')
    expect(activated).toMatchObject({ state: 'scheduled', resultReason: null })
    expect(await db.select().from(matchSlots).where(eq(matchSlots.matchId, activated.id))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 'a', teamId: teamIds[4] }),
        expect.objectContaining({ slot: 'b', teamId: teamIds[0] }),
      ]),
    )

    await play('grand-final-reset', 1, 1, 'home')
    await expect(db.select({ state: categories.state }).from(categories).where(eq(categories.id, categoryId))).resolves.toEqual([
      { state: 'finished' },
    ])
    await expect(db.select({ state: tournaments.state }).from(tournaments).where(eq(tournaments.id, tournamentId))).resolves.toEqual([
      { state: 'finished' },
    ])
  })

  it('supports reverse-order corrections only', async () => {
    await seedBracket(4)
    await play('winners-round', 1, 1, 'home')
    await play('winners-round', 1, 2, 'home')
    await play('winners-final', 2, 1, 'home')
    const first = await match('winners-round', 1, 1)
    const final = await match('winners-final', 2, 1)

    await expect(clearResult(first.id, first.version)).rejects.toThrow('partidos posteriores')
    await expect(clearResult(final.id, final.version)).resolves.toBeUndefined()
    await expect(clearResult(first.id, first.version)).resolves.toBeUndefined()
    await expect(match('winners-final', 2, 1)).resolves.toMatchObject({ state: 'pending' })
  })

  it('records a result for an in-progress match', async () => {
    await seedBracket()
    const first = await match('winners-final')
    await schedule(first.id)
    const started = await startMatch(first.id, first.version)

    const completed = await recordResult({
      matchId: first.id,
      version: started.version,
      sets: [{ home: 6, away: 3 }, { home: 6, away: 3 }],
    })
    expect(completed).toMatchObject({ state: 'completed', winnerTeamId: teamIds[0], actualEndAt: expect.any(Date) })
  })

  it('accepts a seven-five long set with a two-game margin', async () => {
    await seedBracket()
    const first = await match('winners-final')
    await schedule(first.id)

    const completed = await recordResult({
      matchId: first.id,
      version: first.version,
      sets: [{ home: 7, away: 5 }, { home: 6, away: 4 }],
    })
    expect(completed).toMatchObject({ state: 'completed', winnerTeamId: teamIds[0], score: [{ home: 7, away: 5 }, { home: 6, away: 4 }] })
  })

  it('rejects stale result versions and unfinished matches', async () => {
    await seedBracket()
    await db
      .update(matches)
      .set({ state: 'pending', courtId: null, scheduledStartAt: null, scheduledEndAt: null })
      .where(and(eq(matches.categoryId, categoryId), eq(matches.stage, 'winners-final')))
    const first = await match('winners-final')
    await expect(recordResult({ matchId: first.id, version: first.version, sets: [{ home: 9, away: 7 }] })).rejects.toThrow('programado')
    await schedule(first.id)
    await expect(recordResult({ matchId: first.id, version: first.version - 1, sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }] })).rejects.toThrow(
      'Datos desactualizados',
    )

    const completed = await play('winners-final', 1, 1, 'home')
    await expect(recordResult({ matchId: first.id, version: completed.version, sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }] })).rejects.toThrow(
      'ya tiene resultado',
    )
  })

  it('moves only a scheduled match into progress and records its actual start', async () => {
    await seedBracket()
    await db
      .update(matches)
      .set({ state: 'pending', courtId: null, scheduledStartAt: null, scheduledEndAt: null })
      .where(and(eq(matches.categoryId, categoryId), eq(matches.stage, 'winners-final')))
    const first = await match('winners-final')
    await expect(startMatch(first.id, first.version)).rejects.toThrow('programado')
    await schedule(first.id)

    const started = await startMatch(first.id, first.version)

    expect(started).toMatchObject({ state: 'in_progress', actualStartAt: expect.any(Date) })
    await expect(startMatch(first.id, started.version)).rejects.toThrow('programado')
  })

  it('refuses to clear a result after a dependent match finishes', async () => {
    await seedBracket(4)
    const first = await match('winners-round', 1, 1)
    const second = await match('winners-round', 1, 2)
    await schedule(first.id)
    await schedule(second.id)
    await recordResult({ matchId: first.id, version: first.version, sets: [{ home: 9, away: 7 }] })
    await recordResult({ matchId: second.id, version: second.version, sets: [{ home: 9, away: 7 }] })
    const dependent = await match('winners-final', 2, 1)
    await schedule(dependent.id)
    await recordResult({ matchId: dependent.id, version: dependent.version, sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }] })

    await expect(clearResult(first.id, first.version + 1)).rejects.toThrow('partidos posteriores')
  })

  it('records short and long forfeits with their reason', async () => {
    await seedBracket(4)
    const first = await match('winners-round', 1, 1)
    await schedule(first.id)
    const shortForfeit = await recordForfeit({
      matchId: first.id,
      version: first.version,
      forfeitTeamId: teamIds[1]!,
      reason: 'absence',
    })
    expect(shortForfeit).toMatchObject({ state: 'forfeit', resultReason: 'absence', winnerTeamId: teamIds[0], loserTeamId: teamIds[1] })
    expect(shortForfeit.score).toEqual([{ home: 9, away: 0 }])

    const second = await match('winners-round', 1, 2)
    await schedule(second.id)
    await recordResult({ matchId: second.id, version: second.version, sets: [{ home: 9, away: 7 }] })
    const winnersFinal = await match('winners-final', 2, 1)
    await schedule(winnersFinal.id)
    await recordResult({ matchId: winnersFinal.id, version: winnersFinal.version, sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }] })
    const losersRound = await match('losers-round', 1, 1)
    await schedule(losersRound.id)
    await recordResult({ matchId: losersRound.id, version: losersRound.version, sets: [{ home: 9, away: 7 }] })
    const losersFinal = await match('losers-final', 2, 1)
    await schedule(losersFinal.id)
    await recordResult({ matchId: losersFinal.id, version: losersFinal.version, sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }] })
    const grandFinal = await match('grand-final')
    await schedule(grandFinal.id)
    const longForfeit = await recordForfeit({
      matchId: grandFinal.id,
      version: grandFinal.version,
      forfeitTeamId: teamIds[0]!,
      reason: 'retirement',
    })
    expect(longForfeit.score).toEqual([{ home: 0, away: 6 }, { home: 0, away: 6 }])
  })

  it('allows one eligible substitution before a team starts', async () => {
    await seedBracket()
    const replacement = await db
      .insert(participants)
      .values({ id: 'replacement', tournamentId, name: 'Reemplazo', gender: 'man', level: 4 })
      .returning()
    await db.insert(registrations).values({ id: 'registration-replacement', participantId: replacement[0]!.id, categoryId })

    await expect(
      substitutePlayer({
        teamId: teamIds[0]!,
        outgoingParticipantId: participantIds[0]!,
        replacementParticipantId: replacement[0]!.id,
      }),
    ).resolves.toBeUndefined()
    await expect(
      db.select({ participantId: teamMembers.participantId }).from(teamMembers).where(eq(teamMembers.teamId, teamIds[0]!)),
    ).resolves.toEqual(expect.arrayContaining([{ participantId: replacement[0]!.id }]))

    await expect(
      substitutePlayer({
        teamId: teamIds[0]!,
        outgoingParticipantId: participantIds[1]!,
        replacementParticipantId: participantIds[0]!,
      }),
    ).rejects.toThrow('una sustitucion')
  })

  it('rejects a substitution after the team starts or with an ineligible replacement', async () => {
    await seedBracket(4)
    const replacement = await db
      .insert(participants)
      .values({ id: 'replacement', tournamentId, name: 'Reemplazo', gender: 'man', level: 4 })
      .returning()
    await db.insert(registrations).values({ id: 'registration-replacement', participantId: replacement[0]!.id, categoryId })

    await play('winners-round', 1, 1, 'home')
    await expect(
      substitutePlayer({
        teamId: teamIds[0]!,
        outgoingParticipantId: participantIds[0]!,
        replacementParticipantId: replacement[0]!.id,
      }),
    ).rejects.toThrow('comenzo un partido')

    const unregistered = await db
      .insert(participants)
      .values({ id: 'unregistered', tournamentId, name: 'Sin registrar', gender: 'man', level: 3 })
      .returning()
    await expect(
      substitutePlayer({
        teamId: teamIds[2]!,
        outgoingParticipantId: participantIds[4]!,
        replacementParticipantId: unregistered[0]!.id,
      }),
    ).rejects.toThrow('no esta inscripto')

    const woman = await db
      .insert(participants)
      .values({ id: 'woman', tournamentId, name: 'Jugadora', gender: 'woman', level: 3 })
      .returning()
    await db.insert(registrations).values({ id: 'registration-woman', participantId: woman[0]!.id, categoryId })
    await expect(
      substitutePlayer({
        teamId: teamIds[2]!,
        outgoingParticipantId: participantIds[4]!,
        replacementParticipantId: woman[0]!.id,
      }),
    ).rejects.toThrow('compatible con la categoria')

    await expect(
      substitutePlayer({
        teamId: teamIds[2]!,
        outgoingParticipantId: participantIds[4]!,
        replacementParticipantId: participantIds[1]!,
      }),
    ).rejects.toThrow('otra pareja de la categoria')
  })

  it('does not let another organizer record a result through the action', async () => {
    await seedBracket()
    const first = await match('winners-final')
    await schedule(first.id)
    vi.mocked(requireUser).mockResolvedValue({ id: 'other-organizer-id', username: 'organizador2', role: 'organizer' })
    const formData = new FormData()
    formData.set('matchId', first.id)
    formData.set('version', String(first.version))
    formData.set('sets', JSON.stringify([{ home: 9, away: 7 }]))

    await expect(recordResultAction({}, formData)).resolves.toEqual({ error: 'No tienes permisos para este torneo' })
  })

  it('lets an administrator record a result and still enforces sports validation', async () => {
    await seedBracket(4)
    const first = await match('winners-round', 1, 1)
    await schedule(first.id)
    vi.mocked(requireUser).mockResolvedValue({ id: 'admin-id', username: 'admin1', role: 'admin' })
    const formData = new FormData()
    formData.set('matchId', first.id)
    formData.set('version', String(first.version))
    formData.set('sets', JSON.stringify([{ home: 9, away: 8 }]))

    await expect(recordResultAction({}, formData)).resolves.toEqual({ success: 'Resultado guardado' })

    const second = await match('winners-round', 1, 2)
    await schedule(second.id)
    const invalid = new FormData()
    invalid.set('matchId', second.id)
    invalid.set('version', String(second.version))
    invalid.set('sets', JSON.stringify([{ home: 8, away: 7 }]))
    await expect(recordResultAction({}, invalid)).resolves.toEqual({ error: 'El marcador no es valido' })
  })

  it('flags a match scheduled past the tournament end limit without adding a column', async () => {
    await seedBracket()
    const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
    const first = await match('winners-final')
    await db
      .update(matches)
      .set({
        state: 'scheduled',
        courtId: enabledCourtId,
        scheduledStartAt: tournamentInstant(tournament!, tournament!.endsAt),
        scheduledEndAt: new Date(tournamentInstant(tournament!, tournament!.endsAt).getTime() + 90 * 60_000),
      })
      .where(eq(matches.id, first.id))

    const board = await listTournamentMatches(tournamentId)
    const entry = board.find((row) => row.match.id === first.id)!
    expect(entry.afterEndWarning).toBe(true)
    expect(entry.match.scheduledEndAt!.getTime()).toBeGreaterThan(tournamentInstant(tournament!, tournament!.endsAt).getTime())
  })

  it('rejects stale move versions and stamps the actual start on a direct result', async () => {
    await seedBracket()
    const first = await match('winners-final')
    await schedule(first.id)
    await expect(
      moveMatch({
        matchId: first.id,
        version: first.version + 1,
        tournamentId,
        courtId: enabledCourtId,
        startsAt: tournamentInstant((await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)))[0]!, '10:00'),
      }),
    ).rejects.toThrow('Datos desactualizados')

    const completed = await recordResult({
      matchId: first.id,
      version: first.version,
      sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }],
    })
    expect(completed.actualStartAt).toBeInstanceOf(Date)
  })

  it('excludes the unactivated conditional reset from the operator board', async () => {
    await seedBracket()
    const reset = await match('grand-final-reset')
    const board = await listTournamentMatches(tournamentId)
    expect(board.some((entry) => entry.match.id === reset.id)).toBe(false)
  })

  it('exposes eligible substitution teams and category replacement candidates', async () => {
    await seedBracket()
    const replacement = await db
      .insert(participants)
      .values({ id: 'board-replacement', tournamentId, name: 'Reemplazo tablero', gender: 'man', level: 4 })
      .returning()
    await db.insert(registrations).values({ id: 'registration-board-replacement', participantId: replacement[0]!.id, categoryId })
    await db.update(tournaments).set({ state: 'in_progress' }).where(eq(tournaments.id, tournamentId))
    await db.update(categories).set({ state: 'in_progress' }).where(eq(categories.id, categoryId))

    const board = await listTournamentMatches(tournamentId)
    const entry = board.find((row) => row.homeTeam?.id === teamIds[0])!
    expect(entry.homeTeam).toMatchObject({
      eligibleForSubstitution: true,
      members: expect.arrayContaining([expect.objectContaining({ id: participantIds[0] })]),
    })
    expect(entry.replacementCandidates).toEqual(expect.arrayContaining([expect.objectContaining({ id: replacement[0]!.id })]))

    const final = await match('winners-final')
    await db.update(matches).set({ state: 'in_progress' }).where(eq(matches.id, final.id))
    const afterStart = await listTournamentMatches(tournamentId)
    expect(afterStart.find((row) => row.homeTeam?.id === teamIds[0])!.homeTeam).toMatchObject({
      eligibleForSubstitution: false,
    })
  })
})
