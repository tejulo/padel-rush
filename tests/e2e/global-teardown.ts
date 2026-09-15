import { resetDatabase } from '../../src/lib/test/database'

export default async function globalTeardown(): Promise<void> {
  await resetDatabase()
}
