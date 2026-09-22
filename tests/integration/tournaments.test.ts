import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, ne, sql } from 'drizzle-orm'

vi.mock('@/lib/auth/guards', () => ({ requireRole: vi.fn(), requireUser: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { db } from '@/lib/db/client'
import { defaultFormatConfig } from '@/lib/domain/format'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { categories, matches, participants, registrations, teamMembers, teams, tournaments, users } from '@/lib/db/schema'
import { requireRole, requireUser } from '@/lib/auth/guards'
import { cancelTournamentAction, createTournamentAction, deleteTournamentAction } from '@/app/actions/tournaments'
import { createBrackets } from '@/lib/services/brackets'
import { listTournamentMatches, recordResult } from '@/lib/services/matches'
import { getGlobalSettings, saveGlobalSettings } from '@/lib/services/settings'
import {
  assertTournamentOwner,
  cancelTournament,
  createTournament,
  deleteTournament,
  getCategories,
  getTournament,
  listActiveOrganizers,
  listTournaments,
  updateTournament,
} from '@/lib/services/tournaments'

describe('tournament management', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
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
      {
        id: 'inactive-organizer-id',
        username: 'organizador-inactivo',
        passwordHash: 'test-hash',
        role: 'organizer',
        state: 'inactive',
      },
    ])
  })

  afterEach(resetDatabase)

  it('assigns tournaments only to active organizers', async () => {
    await expect(createTournament(makeTournamentInput({ organizerId: 'admin-id' }))).rejects.toThrow(
      'Organizador no encontrado',
    )
  })

  it('validates the resolved end-time default against the start time', async () => {
    await expect(
      createTournament(
        makeTournamentInput({
          startsAt: '22:00',
          endsAt: undefined,
          shortMatchMinutes: undefined,
          longMatchMinutes: undefined,
          restMinutes: undefined,
          courtCount: undefined,
        }),
      ),
    ).rejects.toThrow('La hora limite debe ser posterior al inicio')
  })

  it('filters organizer tournaments while administrators see all tournaments', async () => {
    const own = await createTournament(makeTournamentInput())
    const other = await createTournament(makeTournamentInput({ organizerId: 'other-organizer-id', name: 'Otro torneo' }))

    await expect(listTournaments({ id: 'organizer-id', role: 'organizer' })).resolves.toMatchObject([{ id: own.id }])
    await expect(listTournaments({ id: 'admin-id', role: 'admin' })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: own.id }), expect.objectContaining({ id: other.id })]),
    )
  })

  it('rejects cross-owner access while allowing administrators', async () => {
    const tournament = await createTournament(makeTournamentInput())

    expect(() => assertTournamentOwner({ id: 'other-organizer-id', role: 'organizer' }, tournament)).toThrow(
      'No tienes permisos',
    )
    expect(() => assertTournamentOwner({ id: 'admin-id', role: 'admin' }, tournament)).not.toThrow()
  })

  it('increments the tournament version and rejects stale updates', async () => {
    const tournament = await createTournament(makeTournamentInput())
    const updated = await updateTournament({ id: tournament.id, version: tournament.version, name: 'Nuevo nombre' })

    expect(updated.version).toBe(tournament.version + 1)
    await expect(updateTournament({ id: tournament.id, version: tournament.version, name: 'Sobrescribe' })).rejects.toThrow(
      'Datos desactualizados',
    )
    await expect(getTournament(tournament.id)).resolves.toMatchObject({ name: 'Nuevo nombre', version: updated.version })
  })

  it('updates the enabled court set without changing court identities', async () => {
    const tournament = await createTournament(makeTournamentInput({ courtCount: 3 }))
    const courtIds = tournament.courts.map((court) => court.id)
    const twoCourts = await updateTournament({ id: tournament.id, version: tournament.version, courtCount: 2 })

    expect(twoCourts.courts.map((court) => court.enabled)).toEqual([true, true, false])
    expect(twoCourts.courts.map((court) => court.id)).toEqual(courtIds)

    const threeCourts = await updateTournament({
      id: tournament.id,
      version: twoCourts.version,
      courtCount: 3,
    })
    expect(threeCourts.courts.map((court) => court.enabled)).toEqual([true, true, true])
  })

  it('creates one to six courts and adds missing ones when the count grows', async () => {
    const one = await createTournament(makeTournamentInput({ name: 'Una cancha', courtCount: 1 }))
    expect(one.courts.filter((court) => court.enabled)).toHaveLength(1)

    const six = await createTournament(makeTournamentInput({ name: 'Seis canchas', courtCount: 6 }))
    expect(six.courts).toHaveLength(6)
    expect(six.courts.filter((court) => court.enabled)).toHaveLength(6)

    const grown = await updateTournament({ id: one.id, version: one.version, courtCount: 4 })
    expect(grown.courts).toHaveLength(4)
    expect(grown.courts.filter((court) => court.enabled)).toHaveLength(4)

    const shrunk = await updateTournament({ id: grown.id, version: grown.version, courtCount: 2 })
    expect(shrunk.courts.filter((court) => court.enabled)).toHaveLength(2)
  })

  it('rejects court counts outside one to six', async () => {
    await expect(createTournament(makeTournamentInput({ courtCount: 0 }))).rejects.toThrow(
      'El torneo debe tener entre 1 y 6 canchas habilitadas',
    )
    await expect(createTournament(makeTournamentInput({ courtCount: 7 }))).rejects.toThrow(
      'El torneo debe tener entre 1 y 6 canchas habilitadas',
    )
  })

  it('lets an admin assign a new tournament to a selected active organizer', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'admin-id', username: 'admin1', role: 'admin' })
    vi.mocked(requireRole).mockResolvedValue({ id: 'admin-id', username: 'admin1', role: 'admin' })
    const activeOrganizers = await listActiveOrganizers()
    expect(activeOrganizers.map((organizer) => organizer.id)).toEqual(['organizer-id', 'other-organizer-id'])

    const formData = new FormData()
    formData.set('name', 'Torneo administrado')
    formData.set('date', '2026-10-03')
    formData.set('timezone', 'America/Argentina/Buenos_Aires')
    formData.set('startsAt', '09:00')
    formData.set('endsAt', '21:00')
    formData.set('shortMatchMinutes', '40')
    formData.set('longMatchMinutes', '90')
    formData.set('restMinutes', '20')
    formData.set('courtCount', '2')
    formData.set('organizerId', 'other-organizer-id')

    await createTournamentAction({}, formData)

    const created = await listTournaments({ id: 'admin-id', role: 'admin' })
    expect(created).toHaveLength(1)
    expect(created[0]?.organizerId).toBe('other-organizer-id')
    expect(created[0]?.organizerId).not.toBe('admin-id')
  })

  it('returns a clear error when an admin omits the organizer', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'admin-id', username: 'admin1', role: 'admin' })
    const formData = new FormData()
    formData.set('name', 'Torneo sin organizador')

    await expect(createTournamentAction({}, formData)).resolves.toEqual({
      error: 'Selecciona un organizador activo',
    })
  })

  it('uses the authenticated organizer despite a posted organizer id', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'organizer-id', username: 'organizador1', role: 'organizer' })
    const formData = new FormData()
    formData.set('name', 'Torneo propio')
    formData.set('date', '2026-10-03')
    formData.set('timezone', 'America/Argentina/Buenos_Aires')
    formData.set('startsAt', '09:00')
    formData.set('endsAt', '21:00')
    formData.set('shortMatchMinutes', '40')
    formData.set('longMatchMinutes', '90')
    formData.set('restMinutes', '20')
    formData.set('courtCount', '2')
    formData.set('organizerId', 'other-organizer-id')

    await createTournamentAction({}, formData)

    const created = await listTournaments({ id: 'admin-id', role: 'admin' })
    expect(created).toHaveLength(1)
    expect(created[0]?.organizerId).toBe('organizer-id')
  })

  it('parses the format fields from the tournament form', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'organizer-id', username: 'organizador1', role: 'organizer' })
    const formData = new FormData()
    formData.set('name', 'Formateado')
    formData.set('date', '2026-10-03')
    formData.set('timezone', 'America/Argentina/Buenos_Aires')
    formData.set('startsAt', '09:00')
    formData.set('endsAt', '21:00')
    formData.set('courtCount', '3')
    formData.set('regularGames', '6')
    formData.set('regularSets', '1')
    formData.set('finalsGames', '6')
    formData.set('finalsSets', '3')
    formData.set('finalsTieBreak', 'on')
    formData.set('finalsAdvantage', 'con-ventaja')

    await createTournamentAction({}, formData)
    const [created] = await db.select().from(tournaments).where(eq(tournaments.name, 'Formateado'))
    expect(created!.formatConfig.regular).toEqual({ games: 6, sets: 1, tieBreak: false, advantage: false })
    expect(created!.formatConfig.finals).toEqual({ games: 6, sets: 3, tieBreak: true, advantage: true })
  })

  it('rejects an invalid timezone at create and update time', async () => {
    await expect(createTournament(makeTournamentInput({ timezone: 'Mars/Olympus' }))).rejects.toThrow(
      'La zona horaria no es valida',
    )
    const tournament = await createTournament(makeTournamentInput())
    await expect(
      updateTournament({ id: tournament.id, version: tournament.version, timezone: 'Mars/Olympus' }),
    ).rejects.toThrow('La zona horaria no es valida')
  })

  it('copies the default format config and persists a custom one', async () => {
    const defaults = await createTournament(makeTournamentInput())
    expect(defaults.formatConfig).toEqual(defaultFormatConfig())

    const custom = await createTournament(
      makeTournamentInput({
        name: 'Formato custom',
        formatConfig: {
          regular: { games: 6, sets: 1, tieBreak: false, advantage: false },
          finals: { games: 6, sets: 3, tieBreak: true, advantage: true },
        },
      }),
    )
    expect(custom.formatConfig.regular).toEqual({ games: 6, sets: 1, tieBreak: false, advantage: false })

    const updated = await updateTournament({
      id: custom.id,
      version: custom.version,
      formatConfig: {
        regular: { games: 8, sets: 1, tieBreak: true, advantage: false },
        finals: custom.formatConfig.finals,
      },
    })
    expect(updated.formatConfig.regular.games).toBe(8)
  })

  it('rejects format changes after the tournament starts', async () => {
    const tournament = await createTournament(makeTournamentInput())
    await db.update(tournaments).set({ state: 'in_progress' }).where(eq(tournaments.id, tournament.id))
    await expect(
      updateTournament({
        id: tournament.id,
        version: tournament.version,
        formatConfig: {
          regular: { games: 6, sets: 1, tieBreak: true, advantage: false },
          finals: tournament.formatConfig.finals,
        },
      }),
    ).rejects.toThrow('El torneo ya iniciado no permite cambiar su configuracion')
  })

  it('persists global format defaults and fills missing values', async () => {
    await saveGlobalSettings({
      endsAt: '22:00',
      shortMatchMinutes: 35,
      longMatchMinutes: 80,
      restMinutes: 15,
      formatConfig: {
        regular: { games: 6, sets: 1, tieBreak: false, advantage: false },
        finals: { games: 6, sets: 3, tieBreak: true, advantage: true },
      },
    })
    const settings = await getGlobalSettings()
    expect(settings.formatConfig.regular).toEqual({ games: 6, sets: 1, tieBreak: false, advantage: false })
  })

  it('cancels an in-progress tournament keeping results and leaving the champion undecided', async () => {
    const tournament = await createTournament(makeTournamentInput())
    const categoryRows = await getCategories(tournament.id)
    const menCategory = categoryRows.find((category) => category.category === 'men')!
    await db
      .update(categories)
      .set({ state: 'cancelled', version: 2 })
      .where(and(eq(categories.tournamentId, tournament.id), ne(categories.id, menCategory.id)))

    const participantRows = await db
      .insert(participants)
      .values(
        Array.from({ length: 4 }, (_, index) => ({
          id: `participant-${index + 1}`,
          tournamentId: tournament.id,
          name: `Jugador ${index + 1}`,
          gender: 'man' as const,
          level: 3,
        })),
      )
      .returning()
    await db.insert(registrations).values(
      participantRows.map((participant) => ({ id: `registration-${participant.id}`, participantId: participant.id, categoryId: menCategory.id })),
    )
    const teamRows = await db
      .insert(teams)
      .values(
        Array.from({ length: 2 }, (_, index) => ({
          id: `team-${index + 1}`,
          categoryId: menCategory.id,
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
          categoryId: menCategory.id,
        })),
      ),
    )
    await db.update(categories).set({ state: 'locked' }).where(eq(categories.id, menCategory.id))
    await createBrackets(tournament.id)
    const [final] = await db
      .select()
      .from(matches)
      .where(and(eq(matches.categoryId, menCategory.id), eq(matches.stage, 'winners-final')))
    await db.update(matches).set({ state: 'scheduled' }).where(eq(matches.id, final!.id))
    await recordResult({ matchId: final!.id, version: final!.version, sets: [{ home: 6, away: 4 }, { home: 6, away: 4 }] })
    const started = (await getTournament(tournament.id))!

    await cancelTournament(tournament.id, started.version)

    const cancelled = await getTournament(tournament.id)
    expect(cancelled).toMatchObject({ state: 'cancelled', version: started.version + 1 })
    expect(cancelled!.updatedAt).toBeInstanceOf(Date)
    await expect(getCategories(tournament.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: menCategory.id, state: 'in_progress' })]),
    )
    const [finishedFinal] = await db.select().from(matches).where(eq(matches.id, final!.id))
    expect(finishedFinal).toMatchObject({ state: 'completed', winnerTeamId: teamRows[0]!.id })
  })

  it('rejects a cancellation from a finished tournament or with a stale version', async () => {
    const tournament = await createTournament(makeTournamentInput())
    await expect(cancelTournament(tournament.id, tournament.version + 1)).rejects.toThrow('Datos desactualizados')
    await db.update(tournaments).set({ state: 'finished' }).where(eq(tournaments.id, tournament.id))
    const current = (await getTournament(tournament.id))!
    await expect(cancelTournament(tournament.id, current.version)).rejects.toThrow('no se puede cancelar')
  })

  it('does not let another organizer cancel a tournament through the action', async () => {
    const tournament = await createTournament(makeTournamentInput())
    vi.mocked(requireUser).mockResolvedValue({ id: 'other-organizer-id', username: 'organizador2', role: 'organizer' })
    const formData = new FormData()
    formData.set('id', tournament.id)
    formData.set('version', String(tournament.version))

    await expect(cancelTournamentAction({}, formData)).resolves.toEqual({ error: 'No tienes permisos para este torneo' })
    await expect(getTournament(tournament.id)).resolves.toMatchObject({ state: 'draft' })
  })

  it('lets an organizer delete only their own draft and an admin only finished or cancelled tournaments', async () => {
    const organizer = { id: 'organizer-id', role: 'organizer' as const }
    const admin = { id: 'admin-id', role: 'admin' as const }
    const draft = await createTournament(makeTournamentInput())
    await expect(deleteTournament(draft.id, draft.version, organizer)).resolves.toBeUndefined()
    await expect(getTournament(draft.id)).resolves.toBeNull()

    const inProgress = await createTournament(makeTournamentInput({ name: 'En juego' }))
    await db.update(tournaments).set({ state: 'in_progress' }).where(eq(tournaments.id, inProgress.id))
    const current = (await getTournament(inProgress.id))!
    await expect(deleteTournament(inProgress.id, current.version, organizer)).rejects.toThrow('borrador')
    await expect(deleteTournament(inProgress.id, current.version, admin)).rejects.toThrow('finalizados o cancelados')
    await expect(deleteTournament(inProgress.id, current.version, { id: 'other-organizer-id', role: 'organizer' })).rejects.toThrow(
      'No tienes permisos',
    )

    await db.update(tournaments).set({ state: 'cancelled', version: current.version + 1 }).where(eq(tournaments.id, inProgress.id))
    const cancelled = (await getTournament(inProgress.id))!
    await expect(deleteTournament(inProgress.id, cancelled.version, admin)).resolves.toBeUndefined()
    await expect(getTournament(inProgress.id)).resolves.toBeNull()
  })

  it('rejects a cross-owner deletion through the action', async () => {
    const tournament = await createTournament(makeTournamentInput())
    vi.mocked(requireUser).mockResolvedValue({ id: 'other-organizer-id', username: 'organizador2', role: 'organizer' })
    const formData = new FormData()
    formData.set('id', tournament.id)
    formData.set('version', String(tournament.version))

    await expect(deleteTournamentAction({}, formData)).resolves.toEqual({ error: 'No tienes permisos para este torneo' })
    await expect(getTournament(tournament.id)).resolves.not.toBeNull()
  })

  it('inherits custom global defaults when creating a tournament', async () => {
    await saveGlobalSettings({
      endsAt: '19:00',
      shortMatchMinutes: 30,
      longMatchMinutes: 70,
      restMinutes: 10,
      courtCount: 2,
      formatConfig: {
        regular: { games: 6, sets: 1, tieBreak: false, advantage: false },
        finals: { games: 6, sets: 5, tieBreak: true, advantage: true },
      },
    })

    const tournament = await createTournament(makeTournamentInput({ name: 'Hereda defaults' }))

    expect(tournament.courts.filter((court) => court.enabled)).toHaveLength(2)
    expect(tournament.formatConfig.regular).toEqual({ games: 6, sets: 1, tieBreak: false, advantage: false })
    expect(tournament.formatConfig.finals).toEqual({ games: 6, sets: 5, tieBreak: true, advantage: true })
  })

  it('rejects a corrupt stored format config when reading the match board', async () => {
    const tournament = await createTournament(makeTournamentInput({ name: 'Config corrupta' }))
    await db.execute(sql`update tournaments set format_config = '"corrupto"'::jsonb where id = ${tournament.id}`)

    await expect(listTournamentMatches(tournament.id)).rejects.toThrow('El formato del torneo es invalido')
  })
})
