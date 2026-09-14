import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/guards', () => ({ requireRole: vi.fn(), requireUser: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { db } from '@/lib/db/client'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { users } from '@/lib/db/schema'
import { requireRole, requireUser } from '@/lib/auth/guards'
import { createTournamentAction } from '@/app/actions/tournaments'
import {
  assertTournamentOwner,
  createTournament,
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
          enabledCourtCount: undefined,
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
    const tournament = await createTournament(makeTournamentInput({ enabledCourtCount: 3 }))
    const courtIds = tournament.courts.map((court) => court.id)
    const twoCourts = await updateTournament({ id: tournament.id, version: tournament.version, enabledCourtCount: 2 })

    expect(twoCourts.courts.map((court) => court.enabled)).toEqual([true, true, false])
    expect(twoCourts.courts.map((court) => court.id)).toEqual(courtIds)

    const threeCourts = await updateTournament({
      id: tournament.id,
      version: twoCourts.version,
      enabledCourtCount: 3,
    })
    expect(threeCourts.courts.map((court) => court.enabled)).toEqual([true, true, true])
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
    formData.set('enabledCourtCount', '2')
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
    formData.set('enabledCourtCount', '2')
    formData.set('organizerId', 'other-organizer-id')

    await createTournamentAction({}, formData)

    const created = await listTournaments({ id: 'admin-id', role: 'admin' })
    expect(created).toHaveLength(1)
    expect(created[0]?.organizerId).toBe('organizer-id')
  })
})
