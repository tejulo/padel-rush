import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { db } from '@/lib/db/client'
import { sessions, users } from '@/lib/db/schema'
import { validateCredentials, verifyPassword } from '@/lib/auth/password'
import { isLoginLocked, recordLoginAttempt } from '@/lib/auth/rate-limit'

export const SESSION_COOKIE_NAME = 'padel_rush_session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const INVALID_CREDENTIALS_MESSAGE = 'Usuario o contrasena invalidos'

export type Role = 'admin' | 'organizer'

export interface SessionUser {
  id: string
  username: string
  role: Role
}

export type SignInResult =
  | { ok: true; token: string; user: SessionUser }
  | { ok: false; reason: 'invalid-credentials' | 'locked'; message: string }

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await db.insert(sessions).values({
    id: randomUUID(),
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  return token
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(Date.now() + SESSION_TTL_MS),
  })
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (!token) return null

  const [result] = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.state, 'active'),
      ),
    )
    .limit(1)

  return result ?? null
}

export async function signIn(username: string, password: string, ipAddress = 'unknown'): Promise<SignInResult> {
  if (await isLoginLocked(username, ipAddress)) {
    return { ok: false, reason: 'locked', message: INVALID_CREDENTIALS_MESSAGE }
  }

  if (!validateCredentials({ username, password }).ok) {
    await recordLoginAttempt(username, ipAddress, false)
    return { ok: false, reason: 'invalid-credentials', message: INVALID_CREDENTIALS_MESSAGE }
  }

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1)
  const passwordMatches = user ? await verifyPassword(user.passwordHash, password) : false

  if (!user || user.state !== 'active' || !passwordMatches) {
    await recordLoginAttempt(username, ipAddress, false)
    return { ok: false, reason: 'invalid-credentials', message: INVALID_CREDENTIALS_MESSAGE }
  }

  await recordLoginAttempt(username, ipAddress, true)
  const token = await createSession(user.id)
  return {
    ok: true,
    token,
    user: { id: user.id, username: user.username, role: user.role },
  }
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (token) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.revokedAt)))
  }

  cookieStore.delete(SESSION_COOKIE_NAME)
}
