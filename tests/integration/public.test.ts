import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { categories, participants, registrations, teams, teamMembers, tournaments, users } from '@/lib/db/schema'
import { resetDatabase } from '@/lib/test/database'
import { makeTournamentInput } from '@/lib/test/factories'
import { createBrackets } from '@/lib/services/brackets'
import { getPublicTournament } from '@/lib/services/public'
import { createTournament, regeneratePublicToken } from '@/lib/services/tournaments'

describe('public tournament projection', () => {
  let tournamentId = ''
  let token = ''

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
    const categoryRows = await db.select().from(categories).where(eq(categories.tournamentId, tournamentId)).orderBy(asc(categories.category))
    const menCategory = categoryRows.find((category) => category.category === 'men')!
    await db
      .update(categories)
      .set({ state: 'cancelled', version: 2 })
      .where(and(eq(categories.tournamentId, tournamentId), inArray(categories.id, categoryRows.filter((row) => row.id !== menCategory.id).map((row) => row.id))))

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
      participantRows.map((participant) => ({ id: `registration-${participant.id}`, participantId: participant.id, categoryId: menCategory.id })),
    )
    const teamRows = await db
      .insert(teams)
      .values([
        { id: 'team-1', categoryId: menCategory.id, name: 'Pareja 1', levelTotal: 6, locked: true, lockedAt: new Date() },
        { id: 'team-2', categoryId: menCategory.id, name: 'Pareja 2', levelTotal: 6, locked: true, lockedAt: new Date() },
      ])
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
    await createBrackets(tournamentId)
    const [row] = await db.select({ publicToken: tournaments.publicToken }).from(tournaments).where(eq(tournaments.id, tournamentId))
    token = row!.publicToken!
  })

  afterEach(resetDatabase)

  it('returns only public-safe tournament data', async () => {
    const projection = await getPublicTournament(token)
    expect(projection).not.toBeNull()
    expect(projection!.name).toBe('Sabado de padel')
    expect(projection!.categories).toHaveLength(3)
    expect(projection!.categories.filter((entry) => entry.state === 'cancelled')).toHaveLength(2)
    const category = projection!.categories.find((entry) => entry.name === 'men')!
    expect(category.teams.map((team) => team.name)).toEqual(['Pareja 1', 'Pareja 2'])
    expect(category.teams[0]!.members).toEqual(['Jugador 1', 'Jugador 2'])
    expect(category.matches.length).toBeGreaterThan(0)
    expect(Object.keys(category)).toEqual(['id', 'name', 'state', 'teams', 'matches'])
    expect(JSON.stringify(projection)).not.toContain('password')
    expect(JSON.stringify(projection)).not.toContain('level')
  })

  it('does not expose a regenerated public token', async () => {
    const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId))
    const nextToken = await regeneratePublicToken(tournamentId, tournament!.version)
    expect(nextToken).not.toBe(token)
    await expect(getPublicTournament(token)).resolves.toBeNull()
    await expect(getPublicTournament(nextToken)).resolves.not.toBeNull()
  })
})
