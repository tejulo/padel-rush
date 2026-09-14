import { randomUUID } from 'node:crypto'
import { and, eq, gte } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { loginAttempts } from '@/lib/db/schema'

export const MAX_FAILED_LOGIN_ATTEMPTS = 5
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000

export async function isLoginLocked(username: string, ipAddress: string, now = new Date()): Promise<boolean> {
  const cutoff = new Date(now.getTime() - LOGIN_LOCKOUT_MS)
  const [usernameAttempts, ipAttempts] = await Promise.all([
    db
      .select({ id: loginAttempts.id })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.username, username),
          eq(loginAttempts.successful, false),
          gte(loginAttempts.attemptedAt, cutoff),
        ),
      )
      .limit(MAX_FAILED_LOGIN_ATTEMPTS),
    db
      .select({ id: loginAttempts.id })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.ipAddress, ipAddress),
          eq(loginAttempts.successful, false),
          gte(loginAttempts.attemptedAt, cutoff),
        ),
      )
      .limit(MAX_FAILED_LOGIN_ATTEMPTS),
  ])

  return usernameAttempts.length >= MAX_FAILED_LOGIN_ATTEMPTS || ipAttempts.length >= MAX_FAILED_LOGIN_ATTEMPTS
}

export async function recordLoginAttempt(
  username: string,
  ipAddress: string,
  successful: boolean,
): Promise<void> {
  await db.insert(loginAttempts).values({
    id: randomUUID(),
    username,
    ipAddress,
    successful,
  })
}
