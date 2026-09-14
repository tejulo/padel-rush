import { afterEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
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
      state: 'active',
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

  it('uses state as the only user status column', async () => {
    const result = await db.execute<{ column_name: string }>(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
    `)

    expect(result.rows.map((column) => column.column_name)).not.toContain('active')
  })

  it('enforces a single administrator with a partial unique index', async () => {
    const result = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public' and tablename = 'users' and indexname = 'users_single_admin_unique'
    `)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.indexdef).toMatch(/unique.*role.*admin/i)
  })
})
