import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db/client'
import { categories, courts, tournaments } from '@/lib/db/schema'

export interface CreateTournamentInput {
  name: string
  date: string
  timezone: string
  startsAt: string
  endsAt: string
  shortMatchMinutes: number
  longMatchMinutes: number
  restMinutes: number
  organizerId: string
}

export async function createTournament(input: CreateTournamentInput) {
  return db.transaction(async (tx) => {
    const [tournament] = await tx
      .insert(tournaments)
      .values({
        id: randomUUID(),
        ...input,
      })
      .returning()

    const tournamentCourts = await tx
      .insert(courts)
      .values([
        { id: randomUUID(), tournamentId: tournament.id, name: 'Cancha 1', position: 1, covered: true },
        { id: randomUUID(), tournamentId: tournament.id, name: 'Cancha 2', position: 2, covered: true },
        { id: randomUUID(), tournamentId: tournament.id, name: 'Cancha 3', position: 3, covered: false },
      ])
      .returning()

    await tx.insert(categories).values(
      (['men', 'women', 'mixed'] as const).map((category) => ({
        id: randomUUID(),
        tournamentId: tournament.id,
        category,
      })),
    )

    return { ...tournament, courts: tournamentCourts }
  })
}
