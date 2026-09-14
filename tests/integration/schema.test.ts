import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { resetDatabase } from '@/lib/test/database'
import { createTournament } from '@/lib/services/tournaments'

afterEach(resetDatabase)

describe('database schema', () => {
  it('creates two covered courts and one uncovered court for a tournament', async () => {
    await db.insert(users).values({
      id: 'organizer-id',
      username: 'organizador1',
      passwordHash: 'test-hash',
      role: 'organizer',
      active: true,
    })
    const tournament = await createTournament({
      name: 'Sabado de padel',
      date: '2026-10-03',
      timezone: 'America/Argentina/Buenos_Aires',
      startsAt: '09:00',
      endsAt: '21:00',
      shortMatchMinutes: 40,
      longMatchMinutes: 90,
      restMinutes: 20,
      organizerId: 'organizer-id',
    })

    expect(tournament.courts).toHaveLength(3)
    expect(tournament.courts.filter((court) => court.covered)).toHaveLength(2)
  })
})
