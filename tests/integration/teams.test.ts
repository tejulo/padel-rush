import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { requireUser } from '@/lib/auth/guards'
import { saveTeamsAction } from '@/app/actions/teams'
import { db } from '@/lib/db/client'
import { categories, matches, participants, registrations, teamMembers, teams, tournaments, users } from '@/lib/db/schema'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { replaceRegistrations } from '@/lib/services/participants'
import { createTournament } from '@/lib/services/tournaments'
import { cancelCategory, lockTeams, returnTournamentToDraft, saveTeams } from '@/lib/services/teams'

vi.mock('@/lib/auth/guards', () => ({ requireUser: vi.fn(), requireRole: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

describe('team formation', () => {
  let tournamentId = ''
  let categoryId = ''
  let categoryVersion = 1
  let participantIds: string[] = []
  let otherCategoryIds: string[] = []

  beforeEach(async () => {
    vi.clearAllMocks()
    await db.insert(users).values({
      id: 'organizer-id',
      username: 'organizador1',
      passwordHash: 'test-hash',
      role: 'organizer',
      state: 'active',
    })
    await db.insert(users).values({
      id: 'other-organizer-id',
      username: 'organizador2',
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

  async function register(
    targetCategoryId: string,
    entries: Array<{ id: string; gender: 'man' | 'woman'; level?: number }>,
  ): Promise<void> {
    await db.insert(participants).values(
      entries.map((entry) => ({
        id: entry.id,
        tournamentId,
        name: entry.id,
        gender: entry.gender,
        level: entry.level ?? 3,
      })),
    )
    await db.insert(registrations).values(
      entries.map((entry) => ({
        id: `registration-${entry.id}`,
        participantId: entry.id,
        categoryId: targetCategoryId,
      })),
    )
  }

  async function cancelOtherCategories(activeCategoryId: string): Promise<void> {
    const rows = await db.select().from(categories).where(eq(categories.tournamentId, tournamentId))
    for (const row of rows) {
      if (row.id !== activeCategoryId) await cancelCategory(row.id, row.version)
    }
  }

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

  it('rejects a stale category cancellation', async () => {
    await expect(cancelCategory(categoryId, categoryVersion + 1)).rejects.toThrow('Datos desactualizados')
    await expect(db.select({ state: categories.state }).from(categories).where(eq(categories.id, categoryId))).resolves.toEqual([
      { state: 'draft' },
    ])
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

  it('persists mixed teams with one man and one woman', async () => {
    const mixed = (await db
      .select()
      .from(categories)
      .where(and(eq(categories.tournamentId, tournamentId), eq(categories.category, 'mixed'))))[0]!
    await register(mixed.id, [
      { id: 'mixed-man-1', gender: 'man', level: 5 },
      { id: 'mixed-man-2', gender: 'man', level: 2 },
      { id: 'mixed-woman-1', gender: 'woman', level: 1 },
      { id: 'mixed-woman-2', gender: 'woman', level: 4 },
    ])

    const saved = await saveTeams(
      mixed.id,
      [
        { memberIds: ['mixed-man-1', 'mixed-woman-1'] },
        { memberIds: ['mixed-man-2', 'mixed-woman-2'] },
      ],
      mixed.version,
    )

    expect(saved.map((team) => team.levelTotal)).toEqual([6, 6])
    await expect(db.select().from(teamMembers).where(eq(teamMembers.categoryId, mixed.id))).resolves.toHaveLength(4)
  })

  it('rejects locking mixed teams when registered participants are unpaired', async () => {
    const mixed = (await db
      .select()
      .from(categories)
      .where(and(eq(categories.tournamentId, tournamentId), eq(categories.category, 'mixed'))))[0]!
    await register(mixed.id, [
      { id: 'unequal-man-1', gender: 'man' },
      { id: 'unequal-man-2', gender: 'man' },
      { id: 'unequal-woman-1', gender: 'woman' },
      { id: 'unequal-woman-2', gender: 'woman' },
      { id: 'unequal-woman-3', gender: 'woman' },
    ])
    await saveTeams(
      mixed.id,
      [
        { memberIds: ['unequal-man-1', 'unequal-woman-1'] },
        { memberIds: ['unequal-man-2', 'unequal-woman-2'] },
      ],
      mixed.version,
    )
    await cancelOtherCategories(mixed.id)

    await expect(lockTeams(tournamentId)).rejects.toThrow('inscriptos')
    await expect(db.select({ state: categories.state }).from(categories).where(eq(categories.id, mixed.id))).resolves.toEqual([
      { state: 'draft' },
    ])
  })

  it('rejects locking same-gender teams when an odd registration is omitted', async () => {
    const women = (await db
      .select()
      .from(categories)
      .where(and(eq(categories.tournamentId, tournamentId), eq(categories.category, 'women'))))[0]!
    await register(women.id, [
      { id: 'odd-woman-1', gender: 'woman' },
      { id: 'odd-woman-2', gender: 'woman' },
      { id: 'odd-woman-3', gender: 'woman' },
      { id: 'odd-woman-4', gender: 'woman' },
      { id: 'odd-woman-5', gender: 'woman' },
    ])
    await saveTeams(
      women.id,
      [
        { memberIds: ['odd-woman-1', 'odd-woman-2'] },
        { memberIds: ['odd-woman-3', 'odd-woman-4'] },
      ],
      women.version,
    )
    await cancelOtherCategories(women.id)

    await expect(lockTeams(tournamentId)).rejects.toThrow('inscriptos')
  })

  it('rejects duplicate and wrong-gender members through the service', async () => {
    await expect(
      saveTeams(
        categoryId,
        [{ memberIds: [participantIds[0]!, participantIds[1]!] }, { memberIds: [participantIds[1]!, participantIds[2]!] }],
        categoryVersion,
      ),
    ).rejects.toThrow('repetir')

    await register(categoryId, [{ id: 'wrong-gender', gender: 'woman' }])
    await expect(
      saveTeams(
        categoryId,
        [{ memberIds: [participantIds[0]!, 'wrong-gender'] }, { memberIds: [participantIds[2]!, participantIds[3]!] }],
        categoryVersion,
      ),
    ).rejects.toThrow('masculinos')
  })

  it('locks valid teams after explicitly canceling invalid categories', async () => {
    await saveTeams(
      categoryId,
      [
        { memberIds: participantIds.slice(0, 2) },
        { memberIds: participantIds.slice(2, 4) },
        { memberIds: participantIds.slice(4, 6) },
        { memberIds: participantIds.slice(6, 8) },
      ],
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
      { locked: true },
      { locked: true },
    ])
  })

  it('refuses to lock a tournament with no active categories', async () => {
    const allCategoryIds = [categoryId, ...otherCategoryIds]
    for (const categoryIdToCancel of allCategoryIds) await cancelCategory(categoryIdToCancel, 1)

    await expect(lockTeams(tournamentId)).rejects.toThrow('No hay categorias activas')
  })

  it('rejects registration changes after a category is locked', async () => {
    await saveTeams(
      categoryId,
      [
        { memberIds: participantIds.slice(0, 2) },
        { memberIds: participantIds.slice(2, 4) },
        { memberIds: participantIds.slice(4, 6) },
        { memberIds: participantIds.slice(6, 8) },
      ],
      categoryVersion,
    )
    await cancelOtherCategories(categoryId)
    await lockTeams(tournamentId)

    await expect(replaceRegistrations(participantIds[0]!, ['men'], 1)).rejects.toThrow('El torneo no admite cambios')
  })

  it('returns a tournament to draft and removes pending bracket data', async () => {
    await saveTeams(
      categoryId,
      [
        { memberIds: participantIds.slice(0, 2) },
        { memberIds: participantIds.slice(2, 4) },
        { memberIds: participantIds.slice(4, 6) },
        { memberIds: participantIds.slice(6, 8) },
      ],
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
      profile: 'finals',
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

  it('rejects returning to draft after a match has started', async () => {
    await saveTeams(
      categoryId,
      [
        { memberIds: participantIds.slice(0, 2) },
        { memberIds: participantIds.slice(2, 4) },
        { memberIds: participantIds.slice(4, 6) },
        { memberIds: participantIds.slice(6, 8) },
      ],
      categoryVersion,
    )
    await cancelOtherCategories(categoryId)
    await lockTeams(tournamentId)
    await db.update(tournaments).set({ state: 'in_progress' }).where(eq(tournaments.id, tournamentId))
    await db.insert(matches).values({
      id: 'started-match',
      categoryId,
      stage: 'winners-final',
      round: 1,
      position: 1,
      profile: 'finals',
      state: 'in_progress',
    })

    await expect(returnTournamentToDraft(tournamentId)).rejects.toThrow('partidos iniciados')
    await expect(db.select().from(teams).where(eq(teams.categoryId, categoryId))).resolves.toHaveLength(4)
  })

  it('rejects team actions from a different organizer', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'other-organizer-id', username: 'organizador2', role: 'organizer' })
    const formData = new FormData()
    formData.set('tournamentId', tournamentId)
    formData.set('categoryId', categoryId)
    formData.set('version', String(categoryVersion))
    formData.set('teams', JSON.stringify([{ memberIds: participantIds.slice(0, 2) }, { memberIds: participantIds.slice(2, 4) }]))

    await expect(saveTeamsAction({}, formData)).resolves.toEqual({ error: 'No tienes permisos para este torneo' })
  })
})
