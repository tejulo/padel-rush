import { seedE2E } from '../../scripts/seed-e2e'
import { resetDatabase } from '../../src/lib/test/database'

export default async function globalSetup(): Promise<void> {
  await resetDatabase()
  await seedE2E()
}
