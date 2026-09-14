import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { categories, matches, participants, registrations, teamMembers, teams, tournaments, users } from '@/lib/db/schema'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { createTournament } from '@/lib/services/tournaments'
import { cancelCategory, lockTeams, returnTournamentToDraft, saveTeams } from '@/lib/services/teams'

describe('team formation', () => {
  let tournamentId = ''
  let categoryId = ''
  let categoryVersion = 1
  let participantIds: string[] = []
  let otherCategoryIds: string[] = []

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
    const [category] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.tournamentId, tournamentId), eq(categories.category, 'men')))
      .limit(1)
    categoryId = category!.id
    categoryVersion = category!.version
    otherCategoryIds = (
      await db.select({ id: categories.id }).from(categories).where(eq(categories.tournamentId, tournamentId))
    )
      .map((row) => row.id)
      .filter((id) => id !== categoryId)

    const createdParticipants = await db
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
    participantIds = createdParticipants.map((participant) => participant.id)
    await db.insert(registrations).values(
      participantIds.map((participantId) => ({
        id: `registration-${participantId}`,
        participantId,
        categoryId,
      })),
    )
  })

  afterEach(resetDatabase)

  it('persists proposals and increments the category version', async () => {
    const saved = await saveTeams(
      categoryId,
      [
        { memberIds: participantIds.slice(0, 2) },
        { memberIds: participantIds.slice(2, 4) },
        { memberIds: participantIds.slice(4, 6) },
        { memberIds: participantIds.slice(6, 8) },
      ],
      categoryVersion,
    )

    expect(saved).toHaveLength(4)
    expect(saved.every((team) => team.categoryId === categoryId)).toBe(true)
    expect(saved.every((team) => team.locked === false)).toBe(true)
    await expect(db.select().from(teamMembers).where(eq(teamMembers.categoryId, categoryId))).resolves.toHaveLength(8)
  })

  it('rejects a stale category write', async () => {
    const draft = [{ memberIds: participantIds.slice(0, 2) }, { memberIds: participantIds.slice(2, 4) }]
    await saveTeams(categoryId, draft, categoryVersion)

    await expect(saveTeams(categoryId, draft, categoryVersion)).rejects.toThrow('Datos desactualizados')
  })

  it('rejects locked categories with three teams', async () => {
    await saveTeams(
      categoryId,
      [
        { memberIds: participantIds.slice(0, 2) },
        { memberIds: participantIds.slice(2, 4) },
        { memberIds: participantIds.slice(4, 6) },
      ],
      categoryVersion,
    )

    await expect(lockTeams(tournamentId)).rejects.toThrow('potencia de dos')
    await expect(db.select().from(teams).where(eq(teams.categoryId, categoryId))).resolves.toHaveLength(3)
  })

  it('locks valid teams after explicitly canceling invalid categories', async () => {
    await saveTeams(
      categoryId,
      [{ memberIds: participantIds.slice(0, 2) }, { memberIds: participantIds.slice(2, 4) }],
      categoryVersion,
    )
    for (const categoryIdToCancel of otherCategoryIds) await cancelCategory(categoryIdToCancel, 1)

    await expect(lockTeams(tournamentId)).resolves.toBeUndefined()
    await expect(db.select({ state: categories.state }).from(categories).where(eq(categories.tournamentId, tournamentId))).resolves.toEqual(
      expect.arrayContaining([{ state: 'locked' }, { state: 'cancelled' }, { state: 'cancelled' }]),
    )
    await expect(db.select({ locked: teams.locked }).from(teams).where(eq(teams.categoryId, categoryId))).resolves.toEqual([
      { locked: true },
      { locked: true },
    ])
  })

  it('refuses to lock a tournament with no active categories', async () => {
    const allCategoryIds = [categoryId, ...otherCategoryIds]
    for (const categoryIdToCancel of allCategoryIds) await cancelCategory(categoryIdToCancel, 1)

    await expect(lockTeams(tournamentId)).rejects.toThrow('No hay categorias activas')
  })

  it('returns a tournament to draft and removes pending bracket data', async () => {
    await saveTeams(
      categoryId,
      [{ memberIds: participantIds.slice(0, 2) }, { memberIds: participantIds.slice(2, 4) }],
      categoryVersion,
    )
    for (const categoryIdToCancel of otherCategoryIds) await cancelCategory(categoryIdToCancel, 1)
    await lockTeams(tournamentId)
    await db.update(tournaments).set({ state: 'in_progress' }).where(eq(tournaments.id, tournamentId))
    await db.insert(matches).values({
      id: 'pending-match',
      categoryId,
      stage: 'winners-final',
      round: 1,
      position: 1,
      format: 'best-of-three',
      state: 'pending',
    })

    await expect(returnTournamentToDraft(tournamentId)).resolves.toBeUndefined()
    await expect(db.select({ state: tournaments.state }).from(tournaments).where(eq(tournaments.id, tournamentId))).resolves.toEqual([
      { state: 'draft' },
    ])
    await expect(db.select().from(matches).where(eq(matches.id, 'pending-match'))).resolves.toHaveLength(0)
    await expect(db.select().from(teams).where(eq(teams.categoryId, categoryId))).resolves.toHaveLength(0)
    await expect(db.select({ state: categories.state }).from(categories).where(eq(categories.tournamentId, tournamentId))).resolves.toEqual([
      { state: 'draft' },
      { state: 'draft' },
      { state: 'draft' },
    ])
  })
})
