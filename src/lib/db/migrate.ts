import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './client'
import { bootstrapAdmin } from '@/lib/services/users'

try {
  await migrate(db, { migrationsFolder: './drizzle' })
  if (process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    await bootstrapAdmin()
  }
} finally {
  await pool.end()
}
