import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { signIn } from '@/lib/auth/session'
import { resetDatabase } from '@/lib/test/database'

const password = 'padel-seguro1'

beforeEach(async () => {
  await db.insert(users).values({
    id: 'organizer-id',
    username: 'organizador1',
    passwordHash: await hashPassword(password),
    role: 'organizer',
    state: 'active',
  })
})

afterEach(resetDatabase)

describe('authentication', () => {
  it('locks a username and IP after five invalid attempts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn('organizador1', 'incorrecta', '127.0.0.1')
    }

    await expect(signIn('organizador1', password, '127.0.0.1')).resolves.toMatchObject({ ok: false, reason: 'locked' })
  })

  it('does not share a lock between different IP addresses', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn('organizador1', 'incorrecta', '127.0.0.1')
    }

    await expect(signIn('organizador1', password, '127.0.0.2')).resolves.toMatchObject({ ok: true })
  })

  it('stores only a hash when a session is created', async () => {
    const [user] = await db.select().from(users).where(eq(users.id, 'organizer-id'))
    const result = await signIn('organizador1', password, '127.0.0.1')

    expect(user?.passwordHash).toMatch(/^\$argon2id\$/)
    expect(user?.passwordHash).not.toBe(password)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return

    const [session] = await db.select().from(sessions).where(eq(sessions.userId, 'organizer-id'))
    expect(session?.tokenHash).toBeTruthy()
    expect(session?.tokenHash).not.toBe(result.token)
    expect(session?.tokenHash).not.toContain(result.token)
  })
})
