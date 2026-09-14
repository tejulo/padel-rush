import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'

const organizer = { username: 'organizador1', password: 'padel-seguro1' }

export async function seedE2E(): Promise<void> {
  const [existing] = await db.select().from(users).where(eq(users.username, organizer.username)).limit(1)
  if (existing) return

  await db.insert(users).values({
    id: randomUUID(),
    username: organizer.username,
    passwordHash: await hashPassword(organizer.password),
    role: 'organizer',
    state: 'active',
  })
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
