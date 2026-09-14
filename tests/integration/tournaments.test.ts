import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { users } from '@/lib/db/schema'
import {
  assertTournamentOwner,
  createTournament,
  getTournament,
  listTournaments,
  updateTournament,
} from '@/lib/services/tournaments'

describe('tournament management', () => {
  beforeEach(async () => {
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
})
