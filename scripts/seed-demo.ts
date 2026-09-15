import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { categories, participants, registrations, tournaments, users } from '@/lib/db/schema'
import type { Category, Gender } from '@/lib/domain/types'
import { hashPassword } from '@/lib/auth/password'
import { lockTeams, saveTeams } from '@/lib/services/teams'
import { createTournament } from '@/lib/services/tournaments'

interface DemoParticipant {
  name: string
  gender: Gender
  level: number
  categories: Category[]
}

const demoParticipants: DemoParticipant[] = [
  ...[5, 4, 2, 1].map((level, index) => ({ name: `Masculino ${index + 1}`, gender: 'man' as const, level, categories: ['men'] as Category[] })),
  ...[5, 3, 2, 1].map((level, index) => ({ name: `Femenino ${index + 1}`, gender: 'woman' as const, level, categories: ['women'] as Category[] })),
  ...[5, 2].map((level, index) => ({ name: `Mixto M${index + 1}`, gender: 'man' as const, level, categories: ['mixed'] as Category[] })),
  ...[4, 1].map((level, index) => ({ name: `Mixto F${index + 1}`, gender: 'woman' as const, level, categories: ['mixed'] as Category[] })),
]

async function upsertUser(username: string, password: string, role: 'admin' | 'organizer') {
  const passwordHash = await hashPassword(password)
  const [byName] = await db.select().from(users).where(eq(users.username, username)).limit(1)
  const [byRole] = role === 'admin' ? await db.select().from(users).where(eq(users.role, 'admin')).limit(1) : []
  const existing = byName ?? byRole
  if (existing) {
    const [updated] = await db
      .update(users)
      .set({ username, passwordHash, role, state: 'active', updatedAt: new Date() })
      .where(eq(users.id, existing.id))
      .returning()
    return updated!
  }
  const [created] = await db
    .insert(users)
    .values({ id: randomUUID(), username, passwordHash, role, state: 'active' })
    .returning()
  return created!
}

export async function seedDemo(): Promise<void> {
  const adminUsername = process.env.DEMO_ADMIN_USERNAME
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD
  const organizerUsername = process.env.DEMO_ORGANIZER_USERNAME
  const organizerPassword = process.env.DEMO_ORGANIZER_PASSWORD
  if (!adminUsername || !adminPassword || !organizerUsername || !organizerPassword) {
    throw new Error('Define DEMO_ADMIN_USERNAME, DEMO_ADMIN_PASSWORD, DEMO_ORGANIZER_USERNAME y DEMO_ORGANIZER_PASSWORD')
  }

  await upsertUser(adminUsername, adminPassword, 'admin')
  const organizer = await upsertUser(organizerUsername, organizerPassword, 'organizer')

  const [existingTournament] = await db
    .select()
    .from(tournaments)
    .where(and(eq(tournaments.organizerId, organizer.id), eq(tournaments.name, 'Torneo demostracion')))
    .limit(1)
  if (existingTournament) return

  const tournament = await createTournament({
    name: 'Torneo demostracion',
    date: new Date().toISOString().slice(0, 10),
    timezone: 'America/Argentina/Buenos_Aires',
    startsAt: '09:00',
    endsAt: '21:00',
    shortMatchMinutes: 40,
    longMatchMinutes: 90,
    restMinutes: 20,
    organizerId: organizer.id,
    enabledCourtCount: 3,
  })
  const categoryRows = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournament.id))
    .orderBy(asc(categories.category))

  const created = await db
    .insert(participants)
    .values(
      demoParticipants.map((participant) => ({
        id: randomUUID(),
        tournamentId: tournament.id,
        name: participant.name,
        gender: participant.gender,
        level: participant.level,
      })),
    )
    .returning()
  await db.insert(registrations).values(
    created.flatMap((participant, index) =>
      demoParticipants[index]!.categories.map((category) => ({
        id: randomUUID(),
        participantId: participant.id,
        categoryId: categoryRows.find((row) => row.category === category)!.id,
      })),
    ),
  )

  for (const category of categoryRows) {
    const categoryParticipants = created.filter((_, index) => demoParticipants[index]!.categories.includes(category.category))
    const proposals: { memberIds: string[] }[] = []
    const sorted = [...categoryParticipants].sort((left, right) => right.level - left.level)
    while (sorted.length > 1) {
      proposals.push({ memberIds: [sorted.shift()!.id, sorted.pop()!.id] })
    }
    await saveTeams(category.id, proposals, category.version)
  }
  await lockTeams(tournament.id)
}

if (process.argv[1]?.endsWith('seed-demo.ts')) {
  seedDemo()
    .then(() => {
      console.log('demo seed ready')
      process.exit(0)
    })
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
