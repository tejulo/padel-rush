import { randomUUID } from 'node:crypto'
import { and, asc, eq, lte } from 'drizzle-orm'
import type { SessionUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { categories, courts, tournaments, users, type Court, type Tournament } from '@/lib/db/schema'

export const tournamentDefaults = {
  endsAt: '21:00',
  shortMatchMinutes: 40,
  longMatchMinutes: 90,
  restMinutes: 20,
} as const

export interface CreateTournamentInput {
  name: string
  date: string
  timezone: string
  startsAt: string
  endsAt?: string
  shortMatchMinutes?: number
  longMatchMinutes?: number
  restMinutes?: number
  organizerId: string
  enabledCourtCount?: 2 | 3
}

export interface UpdateTournamentInput {
  id: string
  version: number
  name?: string
  date?: string
  timezone?: string
  startsAt?: string
  endsAt?: string
  shortMatchMinutes?: number
  longMatchMinutes?: number
  restMinutes?: number
  enabledCourtCount?: 2 | 3
}

export type TournamentWithCourts = Tournament & { courts: Court[] }

function assertTournamentInput(input: CreateTournamentInput): void {
  if (!input.name.trim()) throw new Error('El nombre del torneo es obligatorio')
  if (!input.date || !input.timezone || !input.startsAt) throw new Error('Faltan datos del torneo')
  if (input.endsAt !== undefined && input.startsAt >= input.endsAt) {
    throw new Error('La hora limite debe ser posterior al inicio')
  }
  if (
    input.shortMatchMinutes !== undefined &&
    (!Number.isInteger(input.shortMatchMinutes) || input.shortMatchMinutes <= 0)
  ) {
    throw new Error('La duracion corta debe ser positiva')
  }
  if (
    input.longMatchMinutes !== undefined &&
    (!Number.isInteger(input.longMatchMinutes) || input.longMatchMinutes <= 0)
  ) {
    throw new Error('La duracion larga debe ser positiva')
  }
  if (input.restMinutes !== undefined && (!Number.isInteger(input.restMinutes) || input.restMinutes < 0)) {
    throw new Error('El descanso no puede ser negativo')
  }
  if (input.enabledCourtCount !== undefined && ![2, 3].includes(input.enabledCourtCount)) {
    throw new Error('El torneo debe tener dos o tres canchas habilitadas')
  }
}

function assertUpdateInput(input: UpdateTournamentInput): void {
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error('Version invalida')
  if (input.name !== undefined && !input.name.trim()) throw new Error('El nombre del torneo es obligatorio')
  if (input.date !== undefined && !input.date) throw new Error('Falta la fecha del torneo')
  if (input.timezone !== undefined && !input.timezone) throw new Error('Falta la zona horaria')
  if (input.startsAt !== undefined && !input.startsAt) throw new Error('Falta la hora de inicio')
  if (input.endsAt !== undefined && !input.endsAt) throw new Error('Falta la hora limite')
  assertTournamentInput({
    name: input.name ?? 'Torneo',
    date: input.date ?? '2000-01-01',
    timezone: input.timezone ?? 'UTC',
    startsAt: input.startsAt ?? '00:00',
    endsAt: input.endsAt,
    shortMatchMinutes: input.shortMatchMinutes,
    longMatchMinutes: input.longMatchMinutes,
    restMinutes: input.restMinutes,
    organizerId: 'organizer',
    enabledCourtCount: input.enabledCourtCount,
  })
}

export function assertTournamentOwner(user: Pick<SessionUser, 'id' | 'role'>, tournament: Tournament): void {
  if (user.role !== 'admin' && tournament.organizerId !== user.id) {
    throw new Error('No tienes permisos para este torneo')
  }
}

export async function getTournament(id: string): Promise<TournamentWithCourts | null> {
  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, id)).limit(1)
  if (!tournament) return null

  const tournamentCourts = await db
    .select()
    .from(courts)
    .where(eq(courts.tournamentId, id))
    .orderBy(asc(courts.position))

  return { ...tournament, courts: tournamentCourts }
}

export async function listTournaments(user: Pick<SessionUser, 'id' | 'role'>): Promise<Tournament[]> {
  const query = db.select().from(tournaments)
  return user.role === 'admin'
    ? query.orderBy(asc(tournaments.date), asc(tournaments.startsAt))
    : query.where(eq(tournaments.organizerId, user.id)).orderBy(asc(tournaments.date), asc(tournaments.startsAt))
}

export async function getCategories(tournamentId: string) {
  return db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId))
    .orderBy(asc(categories.category))
}

export async function createTournament(input: CreateTournamentInput): Promise<TournamentWithCourts> {
  assertTournamentInput(input)
  const endsAt = input.endsAt ?? tournamentDefaults.endsAt
  const shortMatchMinutes = input.shortMatchMinutes ?? tournamentDefaults.shortMatchMinutes
  const longMatchMinutes = input.longMatchMinutes ?? tournamentDefaults.longMatchMinutes
  const restMinutes = input.restMinutes ?? tournamentDefaults.restMinutes
  const enabledCourtCount = input.enabledCourtCount ?? 3

  return db.transaction(async (tx) => {
    const [organizer] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.organizerId), eq(users.state, 'active')))
      .limit(1)
    if (!organizer) throw new Error('Organizador no encontrado')

    const [tournament] = await tx
      .insert(tournaments)
      .values({
        id: randomUUID(),
        name: input.name.trim(),
        date: input.date,
        timezone: input.timezone,
        startsAt: input.startsAt,
        endsAt,
        shortMatchMinutes,
        longMatchMinutes,
        restMinutes,
        organizerId: input.organizerId,
      })
      .returning()

    const tournamentCourts = await tx
      .insert(courts)
      .values([
        { id: randomUUID(), tournamentId: tournament.id, name: 'Cancha 1', position: 1, covered: true, enabled: true },
        { id: randomUUID(), tournamentId: tournament.id, name: 'Cancha 2', position: 2, covered: true, enabled: true },
        {
          id: randomUUID(),
          tournamentId: tournament.id,
          name: 'Cancha 3',
          position: 3,
          covered: false,
          enabled: enabledCourtCount === 3,
        },
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

export async function updateTournament(input: UpdateTournamentInput): Promise<TournamentWithCourts> {
  assertUpdateInput(input)

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(tournaments).where(eq(tournaments.id, input.id)).limit(1)
    if (!current) throw new Error('Torneo no encontrado')

    assertTournamentInput({
      name: input.name ?? current.name,
      date: input.date ?? current.date,
      timezone: input.timezone ?? current.timezone,
      startsAt: input.startsAt ?? current.startsAt,
      endsAt: input.endsAt ?? current.endsAt,
      shortMatchMinutes: input.shortMatchMinutes ?? current.shortMatchMinutes,
      longMatchMinutes: input.longMatchMinutes ?? current.longMatchMinutes,
      restMinutes: input.restMinutes ?? current.restMinutes,
      organizerId: current.organizerId,
      enabledCourtCount: input.enabledCourtCount,
    })

    const immutableFields = [
      'date',
      'timezone',
      'startsAt',
      'endsAt',
      'shortMatchMinutes',
      'longMatchMinutes',
      'restMinutes',
    ] as const
    if (current.state !== 'draft' && immutableFields.some((field) => input[field] !== undefined)) {
      throw new Error('El torneo ya iniciado no permite cambiar su configuracion')
    }

    const [updated] = await tx
      .update(tournaments)
      .set({
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.date === undefined ? {} : { date: input.date }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
        ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt }),
        ...(input.shortMatchMinutes === undefined ? {} : { shortMatchMinutes: input.shortMatchMinutes }),
        ...(input.longMatchMinutes === undefined ? {} : { longMatchMinutes: input.longMatchMinutes }),
        ...(input.restMinutes === undefined ? {} : { restMinutes: input.restMinutes }),
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(tournaments.id, input.id), eq(tournaments.version, input.version)))
      .returning()

    if (!updated) throw new Error('Datos desactualizados')

    if (input.enabledCourtCount !== undefined) {
      await tx.update(courts).set({ enabled: false }).where(eq(courts.tournamentId, input.id))
      await tx
        .update(courts)
        .set({ enabled: true })
        .where(and(eq(courts.tournamentId, input.id), lte(courts.position, input.enabledCourtCount)))
    }

    const updatedCourts = await tx
      .select()
      .from(courts)
      .where(eq(courts.tournamentId, input.id))
      .orderBy(asc(courts.position))
    return { ...updated, courts: updatedCourts }
  })
}
