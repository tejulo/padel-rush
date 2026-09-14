import { randomUUID } from 'node:crypto'
import { and, eq, isNull, notInArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { sessions, tournaments, users } from '@/lib/db/schema'
import { requireRole } from '@/lib/auth/guards'
import { hashPassword } from '@/lib/auth/password'

export interface OrganizerInput {
  username: string
  password: string
}

const terminalTournamentStates: ('finished' | 'completed' | 'cancelled')[] = ['finished', 'completed', 'cancelled']

function assertPassword(password: string): void {
  if (password.length < 12) throw new Error('La contrasena debe tener al menos 12 caracteres')
}

export async function bootstrapAdmin() {
  const [existingAdmin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1)
  if (existingAdmin) return existingAdmin

  const username = process.env.BOOTSTRAP_ADMIN_USERNAME
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD
  if (!username || !password || !/^[A-Za-z0-9]{3,32}$/.test(username)) {
    throw new Error('Faltan credenciales validas para el administrador inicial')
  }
  assertPassword(password)

  const [admin] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      username,
      passwordHash: await hashPassword(password),
      role: 'admin',
      state: 'active',
    })
    .returning()

  return admin
}

export async function createOrganizer(input: OrganizerInput) {
  await requireRole('admin')
  if (!/^[A-Za-z0-9]{3,32}$/.test(input.username)) throw new Error('Usuario invalido')
  assertPassword(input.password)

  const [organizer] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      username: input.username,
      passwordHash: await hashPassword(input.password),
      role: 'organizer',
      state: 'active',
    })
    .returning()

  return organizer
}

export async function resetOrganizerPassword(organizerId: string, password: string) {
  await requireRole('admin')
  assertPassword(password)

  const [organizer] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, organizerId), eq(users.role, 'organizer')))
    .limit(1)
  if (!organizer) throw new Error('Organizador no encontrado')

  const [updated] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.id, organizerId))
    .returning()

  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, organizerId), isNull(sessions.revokedAt)))

  return updated
}

export async function deactivateOrganizer(organizerId: string, replacementOrganizerId?: string) {
  await requireRole('admin')

  return db.transaction(async (tx) => {
    const [organizer] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, organizerId), eq(users.role, 'organizer')))
      .limit(1)
    if (!organizer) throw new Error('Organizador no encontrado')

    const activeTournaments = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(
        and(eq(tournaments.organizerId, organizerId), notInArray(tournaments.state, terminalTournamentStates)),
      )

    if (activeTournaments.length > 0) {
      if (!replacementOrganizerId || replacementOrganizerId === organizerId) {
        throw new Error('Los torneos activos deben reasignarse antes de desactivar el organizador')
      }

      const [replacement] = await tx
        .select()
        .from(users)
        .where(
          and(
            eq(users.id, replacementOrganizerId),
            eq(users.role, 'organizer'),
            eq(users.state, 'active'),
          ),
        )
        .limit(1)
      if (!replacement) throw new Error('Organizador de reemplazo no encontrado')

      await tx
        .update(tournaments)
        .set({ organizerId: replacementOrganizerId, updatedAt: new Date() })
        .where(
          and(eq(tournaments.organizerId, organizerId), notInArray(tournaments.state, terminalTournamentStates)),
        )
    }

    const [deactivated] = await tx
      .update(users)
      .set({ state: 'inactive', updatedAt: new Date() })
      .where(eq(users.id, organizerId))
      .returning()

    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, organizerId), isNull(sessions.revokedAt)))

    return deactivated
  })
}
