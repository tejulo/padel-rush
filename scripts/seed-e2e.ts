import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'

export async function seedE2E(): Promise<void> {
  await upsertUser('organizador1', 'padel-seguro1', 'organizer')
}

export async function upsertUser(username: string, password: string, role: 'admin' | 'organizer'): Promise<void> {
  const passwordHash = await hashPassword(password)
  const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1)
  if (existing) {
    await db.update(users).set({ passwordHash, state: 'active', role }).where(eq(users.id, existing.id))
    return
  }
  await db.insert(users).values({ id: randomUUID(), username, passwordHash, role, state: 'active' })
}

if (process.argv[1]?.endsWith('seed-e2e.ts')) {
  seedE2E()
    .then(() => {
      console.log('e2e seed ready')
      process.exit(0)
    })
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
