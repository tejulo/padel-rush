import { sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'

export async function resetDatabase(): Promise<void> {
  await db.execute(sql.raw(`
    truncate table
      "app_settings",
      "match_slots",
      "matches",
      "team_members",
      "teams",
      "registrations",
      "participants",
      "categories",
      "courts",
      "tournaments",
      "login_attempts",
      "sessions",
      "users"
    restart identity cascade
  `))
}
