import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { requireUser } from '@/lib/auth/guards'
import { regeneratePublicLinkAction } from '@/app/actions/tournaments'
import { startTournamentAction } from '@/app/actions/teams'
import { db } from '@/lib/db/client'
import { categories, participants, registrations, teams, teamMembers, tournaments, users } from '@/lib/db/schema'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { createTournament } from '@/lib/services/tournaments'

vi.mock('@/lib/auth/guards', () => ({ requireUser: vi.fn(), requireRole: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))

const organizer = { id: 'organizer-id', username: 'organizador1', role: 'organizer' as const }
const otherOrganizer = { id: 'other-organizer-id', username: 'organizador2', role: 'organizer' as const }

function actionForm(entries: Record<string, string>): FormData {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) formData.set(key, value)
  return formData
}

describe('public link and tournament start actions', () => {
  let tournamentId = ''
  let menCategoryId = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue(organizer)
    await db.insert(users).values([
      { id: organizer.id, username: organizer.username, passwordHash: 'test-hash', role: 'organizer', state: 'active' },
      { id: otherOrganizer.id, username: otherOrganizer.username, passwordHash: 'test-hash', role: 'organizer', state: 'active' },
    ])
    const tournament = await createTournament(makeTournamentInput())
    tournamentId = tournament.id
    const categoryRows = await db
      .select()
      .from(categories)
      .where(eq(categories.tournamentId, tournamentId))
      .orderBy(asc(categories.category))
    menCategoryId = categoryRows.find((category) => category.category === 'men')!.id
    await db
      .update(categories)
      .set({ state: 'cancelled', version: 2 })
      .where(and(eq(categories.tournamentId, tournamentId), inArray(categories.id, categoryRows.filter((row) => row.id !== menCategoryId).map((row) => row.id))))

    const participantRows = await db
      .insert(participants)
      .values(
        Array.from({ length: 4 }, (_, index) => ({
          id: `participant-${index + 1}`,
          tournamentId,
          name: `Jugador ${index + 1}`,
          gender: 'man' as const,
          level: 3,
        })),
      )
      .returning()
    await db.insert(registrations).values(
      participantRows.map((participant) => ({ id: `registration-${participant.id}`, participantId: participant.id, categoryId: menCategoryId })),
    )
    const teamRows = await db
      .insert(teams)
      .values([
        { id: 'team-1', categoryId: menCategoryId, name: 'Pareja 1', levelTotal: 6, locked: true, lockedAt: new Date() },
        { id: 'team-2', categoryId: menCategoryId, name: 'Pareja 2', levelTotal: 6, locked: true, lockedAt: new Date() },
      ])
      .returning()
    await db.insert(teamMembers).values(
      teamRows.flatMap((team, index) =>
        participantRows.slice(index * 2, index * 2 + 2).map((participant) => ({
          id: `member-${team.id}-${participant.id}`,
          teamId: team.id,
          participantId: participant.id,
          categoryId: menCategoryId,
        })),
      ),
    )
    await db.update(categories).set({ state: 'locked', version: 2 }).where(eq(categories.id, menCategoryId))
  })

  afterEach(resetDatabase)

  it('regenerates the public link for the owner only', async () => {
    const [current] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
    const result = await regeneratePublicLinkAction({}, actionForm({ id: tournamentId, version: String(current!.version) }))
    expect(result).toEqual({ success: 'Enlace publico regenerado' })
    const [updated] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
    expect(updated!.publicToken).toBeTruthy()
    expect(updated!.version).toBe(current!.version + 1)
  })

  it('rejects public link regeneration from a different organizer', async () => {
    vi.mocked(requireUser).mockResolvedValue(otherOrganizer)
    const [current] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
    const result = await regeneratePublicLinkAction({}, actionForm({ id: tournamentId, version: String(current!.version) }))
    expect(result).toMatchObject({ error: expect.stringContaining('permisos') })
    const [updated] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
    expect(updated!.publicToken).toBeNull()
  })

  it('starts the tournament and generates brackets with a public token', async () => {
    const result = await startTournamentAction({}, actionForm({ tournamentId }))
    expect(result).toEqual({ success: 'Torneo iniciado' })
    const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
    expect(tournament!.state).toBe('in_progress')
    expect(tournament!.publicToken).toBeTruthy()
    const [category] = await db.select().from(categories).where(eq(categories.id, menCategoryId))
    expect(category!.state).toBe('in_progress')
  })

  it('rejects starting a tournament owned by another organizer', async () => {
    vi.mocked(requireUser).mockResolvedValue(otherOrganizer)
    const result = await startTournamentAction({}, actionForm({ tournamentId }))
    expect(result).toMatchObject({ error: expect.stringContaining('permisos') })
    const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
    expect(tournament!.state).toBe('draft')
  })
})
