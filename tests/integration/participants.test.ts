import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { categories, tournaments, users } from '@/lib/db/schema'
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

  it('waits for an in-flight tournament lock before checking category state', async () => {
    let releaseLock!: () => void
    let signalTournamentLock!: () => void
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const tournamentLocked = new Promise<void>((resolve) => {
      signalTournamentLock = resolve
    })

    const lockTransaction = db.transaction(async (tx) => {
      await tx.select().from(tournaments).where(eq(tournaments.id, tournamentId)).for('update')
      signalTournamentLock()
      await release
      await tx
        .select()
        .from(categories)
        .where(and(eq(categories.tournamentId, tournamentId), eq(categories.category, 'women')))
        .for('update')
      await tx
        .update(categories)
        .set({ state: 'locked' })
        .where(and(eq(categories.tournamentId, tournamentId), eq(categories.category, 'women')))
    })

    await tournamentLocked
    const write = createParticipant({
      tournamentId,
      name: 'Ana',
      gender: 'woman',
      level: 4,
      categories: ['women'],
    }).then(
      () => 'created',
      (error: unknown) => (error instanceof Error ? error.message : 'failed'),
    )

    const beforeRelease = await Promise.race([
      write,
      new Promise<'pending'>((resolve) => setImmediate(() => resolve('pending'))),
    ])
    expect(beforeRelease).toBe('pending')
    releaseLock()
    await lockTransaction
    await expect(write).resolves.toBe('El torneo no admite cambios')
  })
})
