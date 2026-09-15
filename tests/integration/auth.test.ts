import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { loginAttempts, sessions, users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { signIn, pruneAuthData } from '@/lib/auth/session'
import { bootstrapAdmin } from '@/lib/services/users'
import { resetDatabase } from '@/lib/test/database'

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const password = 'padel-seguro1'
const bootstrapUsername = 'admininicial'
const bootstrapPassword = 'admin-seguro1'

const previousBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME
const previousBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD

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

afterEach(() => {
  if (previousBootstrapUsername === undefined) delete process.env.BOOTSTRAP_ADMIN_USERNAME
  else process.env.BOOTSTRAP_ADMIN_USERNAME = previousBootstrapUsername
  if (previousBootstrapPassword === undefined) delete process.env.BOOTSTRAP_ADMIN_PASSWORD
  else process.env.BOOTSTRAP_ADMIN_PASSWORD = previousBootstrapPassword
})

describe('authentication', () => {
  it('locks a username and IP after five invalid attempts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn('organizador1', 'incorrecta', '127.0.0.1')
    }

    await expect(signIn('organizador1', password, '127.0.0.1')).resolves.toMatchObject({ ok: false, reason: 'locked' })
  })

  it('locks a username across different IP addresses', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn('organizador1', 'incorrecta', '127.0.0.1')
    }

    await expect(signIn('organizador1', password, '127.0.0.2')).resolves.toMatchObject({ ok: false, reason: 'locked' })
  })

  it('locks an IP across different usernames', async () => {
    await db.insert(users).values({
      id: 'organizer-2-id',
      username: 'organizador2',
      passwordHash: await hashPassword(password),
      role: 'organizer',
      state: 'active',
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn('organizador1', 'incorrecta', '127.0.0.1')
    }

    await expect(signIn('organizador2', password, '127.0.0.1')).resolves.toMatchObject({ ok: false, reason: 'locked' })
  })

  it('locks a username when spoofed IP headers rotate', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await signIn('organizador1', 'incorrecta', `192.0.2.${attempt}`)
    }

    await expect(signIn('organizador1', password, '192.0.2.6')).resolves.toMatchObject({ ok: false, reason: 'locked' })
  })

  it('does not share an IP lock between clients without an IP', async () => {
    await db.insert(users).values({
      id: 'organizer-2-id',
      username: 'organizador2',
      passwordHash: await hashPassword(password),
      role: 'organizer',
      state: 'active',
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn('organizador1', 'incorrecta', null)
    }

    await expect(signIn('organizador2', password, null)).resolves.toMatchObject({ ok: true })
    await expect(signIn('organizador1', password, null)).resolves.toMatchObject({ ok: false, reason: 'locked' })
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

  it('returns one admin when bootstrap runs concurrently', async () => {
    process.env.BOOTSTRAP_ADMIN_USERNAME = bootstrapUsername
    process.env.BOOTSTRAP_ADMIN_PASSWORD = bootstrapPassword

    const results = await Promise.all(Array.from({ length: 8 }, () => bootstrapAdmin()))
    const admins = await db.select().from(users)

    expect(admins.filter((user) => user.role === 'admin')).toHaveLength(1)
    expect(results.every((result) => result.id === admins.find((user) => user.role === 'admin')?.id)).toBe(true)
  })

  it('returns the invalid-credentials message through the sign-in action', async () => {
    const { signInAction } = await import('@/app/actions/auth')
    const formData = new FormData()
    formData.set('username', 'organizador1')
    formData.set('password', 'incorrecta-larga')

    await expect(signInAction({}, formData)).resolves.toEqual({ error: 'Usuario o contrasena invalidos' })
  })

  it('prunes expired sessions and old login attempts', async () => {
    const result = await signIn('organizador1', password, '127.0.0.1')
    expect(result.ok).toBe(true)
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, 'organizer-id'))
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, session!.id))
    await db.insert(loginAttempts).values({
      id: 'old-attempt',
      username: 'organizador1',
      attemptedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    })

    await pruneAuthData()

    await expect(db.select().from(sessions).where(eq(sessions.userId, 'organizer-id'))).resolves.toEqual([])
    await expect(db.select().from(loginAttempts).where(eq(loginAttempts.id, 'old-attempt'))).resolves.toEqual([])
  })
})
