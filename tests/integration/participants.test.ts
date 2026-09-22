import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { categories, participants, registrations, teamMembers, teams, tournaments, users } from '@/lib/db/schema'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { createParticipant, deleteParticipant, replaceRegistrations } from '@/lib/services/participants'
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

  it('rejects a participant without categories', async () => {
    await expect(
      createParticipant({
        tournamentId,
        name: 'Ana',
        gender: 'woman',
        level: 4,
        categories: [],
      }),
    ).rejects.toThrow('El participante debe tener al menos una categoria')
  })

  it('deletes a participant with its registrations and saved team membership', async () => {
    const participant = await createParticipant({
      tournamentId,
      name: 'Ana',
      gender: 'woman',
      level: 4,
      categories: ['women'],
    })
    const [category] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.tournamentId, tournamentId), eq(categories.category, 'women')))
    const [team] = await db
      .insert(teams)
      .values({ id: 'team-1', categoryId: category!.id, name: 'Pareja 1', levelTotal: 4 })
      .returning()
    await db
      .insert(teamMembers)
      .values({ id: 'member-1', teamId: team!.id, participantId: participant.id, categoryId: category!.id })

    await expect(deleteParticipant(participant.id, participant.version)).resolves.toBeUndefined()

    expect(await db.select().from(participants).where(eq(participants.id, participant.id))).toEqual([])
    expect(await db.select().from(registrations).where(eq(registrations.participantId, participant.id))).toEqual([])
    expect(await db.select().from(teamMembers).where(eq(teamMembers.participantId, participant.id))).toEqual([])
  })

  it('rejects deleting a participant after a category is locked', async () => {
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

    await expect(deleteParticipant(participant.id, participant.version)).rejects.toThrow('El torneo no admite cambios')
  })

  it('rejects deleting a participant with a stale version', async () => {
    const participant = await createParticipant({
      tournamentId,
      name: 'Ana',
      gender: 'woman',
      level: 4,
      categories: ['women'],
    })

    await expect(deleteParticipant(participant.id, participant.version + 1)).rejects.toThrow('Datos desactualizados')
  })

  it('allows participant changes while another category is cancelled', async () => {
    await db
      .update(categories)
      .set({ state: 'cancelled' })
      .where(and(eq(categories.tournamentId, tournamentId), inArray(categories.category, ['women', 'mixed'])))

    const participant = await createParticipant({
      tournamentId,
      name: 'Juan',
      gender: 'man',
      level: 4,
      categories: ['men'],
    })

    await expect(deleteParticipant(participant.id, participant.version)).resolves.toBeUndefined()
    expect(await db.select().from(participants).where(eq(participants.id, participant.id))).toEqual([])
  })

  it('rejects registering into a cancelled category', async () => {
    await db
      .update(categories)
      .set({ state: 'cancelled' })
      .where(and(eq(categories.tournamentId, tournamentId), eq(categories.category, 'women')))

    await expect(
      createParticipant({
        tournamentId,
        name: 'Ana',
        gender: 'woman',
        level: 4,
        categories: ['women'],
      }),
    ).rejects.toThrow('La categoria fue cancelada')
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
