import { seedE2E } from '../../scripts/seed-e2e'

export default async function globalSetup(): Promise<void> {
  await seedE2E()
}
