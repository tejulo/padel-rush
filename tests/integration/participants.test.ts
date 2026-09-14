import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { categories, users } from '@/lib/db/schema'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { createParticipant, replaceRegistrations } from '@/lib/services/participants'
import { createTournament } from '@/lib/services/tournaments'

describe('participant registrations', () => {
  let tournamentId = ''

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
  })

  afterEach(resetDatabase)

  it('rejects a stale participant edit instead of overwriting it', async () => {
    const participant = await createParticipant({
      tournamentId,
      name: 'Ana',
      gender: 'woman',
      level: 4,
      categories: ['women'],
    })

    const updated = await replaceRegistrations(participant.id, ['women'], participant.version)

    expect(updated.version).toBe(participant.version + 1)
    await expect(replaceRegistrations(participant.id, ['women', 'mixed'], participant.version)).rejects.toThrow(
      'Datos desactualizados',
    )
  })

  it('rejects a woman registered in the men category', async () => {
    await expect(
      createParticipant({
        tournamentId,
        name: 'Ana',
        gender: 'woman',
        level: 4,
        categories: ['men'],
      }),
    ).rejects.toThrow('La categoria no es compatible con el genero')
  })

  it('rejects registration edits after a category is locked', async () => {
    const participant = await createParticipant({
      tournamentId,
      name: 'Ana',
      gender: 'woman',
      level: 4,
      categories: ['women'],
    })
    await db
      .update(categories)
      .set({ state: 'locked' })
      .where(and(eq(categories.tournamentId, tournamentId), eq(categories.category, 'women')))

    await expect(replaceRegistrations(participant.id, ['women'], participant.version)).rejects.toThrow(
      'El torneo no admite cambios',
    )
  })
})
