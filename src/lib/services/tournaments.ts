import { randomBytes, randomUUID } from 'node:crypto'
import { and, asc, eq, lte } from 'drizzle-orm'
import { requireRole } from '@/lib/auth/guards'
import type { SessionUser } from '@/lib/auth/session'
import { db } from '@/lib/db/client'
import { categories, courts, tournaments, users, type Court, type Tournament } from '@/lib/db/schema'
import { parseFormatConfig, type FormatConfig } from '@/lib/domain/format'
import { replanPendingMatches } from '@/lib/services/scheduling'

export const tournamentDefaults = {
  endsAt: '21:00',
  shortMatchMinutes: 40,
  longMatchMinutes: 90,
  restMinutes: 20,
  courtCount: 3,
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
  courtCount?: number
  formatConfig?: FormatConfig
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
  courtCount?: number
  formatConfig?: FormatConfig
}

export type TournamentWithCourts = Tournament & { courts: Court[] }
export type TournamentTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type ActiveOrganizer = Pick<typeof users.$inferSelect, 'id' | 'username'>
type ResolvedTournamentInput = Omit<
  CreateTournamentInput,
  'endsAt' | 'shortMatchMinutes' | 'longMatchMinutes' | 'restMinutes' | 'courtCount' | 'formatConfig'
> & {
  endsAt: string
  shortMatchMinutes: number
  longMatchMinutes: number
  restMinutes: number
  courtCount: number
  formatConfig: FormatConfig
}

async function resolveWithGlobalSettings(input: CreateTournamentInput): Promise<ResolvedTournamentInput> {
  const { getGlobalSettings } = await import('@/lib/services/settings')
  const defaults = await getGlobalSettings()
  return {
    ...input,
    endsAt: input.endsAt ?? defaults.endsAt,
    shortMatchMinutes: input.shortMatchMinutes ?? defaults.shortMatchMinutes,
    longMatchMinutes: input.longMatchMinutes ?? defaults.longMatchMinutes,
    restMinutes: input.restMinutes ?? defaults.restMinutes,
    courtCount: input.courtCount ?? defaults.courtCount,
    formatConfig: parseFormatConfig(input.formatConfig ?? defaults.formatConfig),
  }
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new Error('La zona horaria no es valida')
  }
}

function assertTournamentInput(input: CreateTournamentInput): void {
  if (!input.name.trim()) throw new Error('El nombre del torneo es obligatorio')
  if (!input.date || !input.timezone || !input.startsAt) throw new Error('Faltan datos del torneo')
  assertTimezone(input.timezone)
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
  if (
    input.courtCount !== undefined &&
    (!Number.isInteger(input.courtCount) || input.courtCount < 1 || input.courtCount > 6)
  ) {
    throw new Error('El torneo debe tener entre 1 y 6 canchas habilitadas')
  }
  if (input.formatConfig !== undefined) parseFormatConfig(input.formatConfig)
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
    courtCount: input.courtCount,
    formatConfig: input.formatConfig,
  })
}

export function assertTournamentOwner(user: Pick<SessionUser, 'id' | 'role'>, tournament: Tournament): void {
  if (user.role !== 'admin' && tournament.organizerId !== user.id) {
    throw new Error('No tienes permisos para este torneo')
  }
}

export async function regeneratePublicToken(tournamentId: string, version: number): Promise<string> {
  const token = randomBytes(24).toString('base64url')
  const [updated] = await db
    .update(tournaments)
    .set({ publicToken: token, version: version + 1, updatedAt: new Date() })
    .where(and(eq(tournaments.id, tournamentId), eq(tournaments.version, version)))
    .returning({ publicToken: tournaments.publicToken })
  if (!updated?.publicToken) throw new Error('Datos desactualizados')
  return updated.publicToken
}

export async function cancelTournament(tournamentId: string, version: number): Promise<void> {
  await db.transaction(async (tx) => {
    const { tournament } = await lockTournamentForWrite(tx, tournamentId)
    if (tournament.state !== 'draft' && tournament.state !== 'in_progress') {
      throw new Error('El torneo no se puede cancelar')
    }
    if (!Number.isInteger(version) || version !== tournament.version) throw new Error('Datos desactualizados')
    await tx
      .update(tournaments)
      .set({ state: 'cancelled', version: tournament.version + 1, updatedAt: new Date() })
      .where(and(eq(tournaments.id, tournamentId), eq(tournaments.version, version)))
  })
}

export async function deleteTournament(
  tournamentId: string,
  version: number,
  user: Pick<SessionUser, 'id' | 'role'>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { tournament } = await lockTournamentForWrite(tx, tournamentId)
    assertTournamentOwner(user, tournament)
    if (user.role === 'admin') {
      if (tournament.state !== 'finished' && tournament.state !== 'cancelled') {
        throw new Error('Solo puedes eliminar torneos finalizados o cancelados')
      }
    } else if (tournament.state !== 'draft') {
      throw new Error('Solo puedes eliminar tus torneos en borrador')
    }
    if (!Number.isInteger(version) || version !== tournament.version) throw new Error('Datos desactualizados')
    await tx.delete(tournaments).where(and(eq(tournaments.id, tournamentId), eq(tournaments.version, version)))
  })
}

export async function lockTournamentForWrite(tx: TournamentTransaction, tournamentId: string) {
  const [tournament] = await tx
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .for('update')
    .limit(1)
  if (!tournament) throw new Error('Torneo no encontrado')

  const tournamentCategories = await tx
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId))
    .orderBy(asc(categories.category))
    .for('update')

  return { tournament, tournamentCategories }
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

export async function listActiveOrganizers(): Promise<ActiveOrganizer[]> {
  await requireRole('admin')
  return db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(and(eq(users.role, 'organizer'), eq(users.state, 'active')))
    .orderBy(asc(users.username))
}

export async function getCategories(tournamentId: string) {
  return db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId))
    .orderBy(asc(categories.category))
}

export async function createTournament(input: CreateTournamentInput): Promise<TournamentWithCourts> {
  const resolved = await resolveWithGlobalSettings(input)
  assertTournamentInput(resolved)

  return db.transaction(async (tx) => {
    const [organizer] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, resolved.organizerId), eq(users.role, 'organizer'), eq(users.state, 'active')))
      .limit(1)
    if (!organizer) throw new Error('Organizador no encontrado')

    const [tournament] = await tx
      .insert(tournaments)
      .values({
        id: randomUUID(),
        name: resolved.name.trim(),
        date: resolved.date,
        timezone: resolved.timezone,
        startsAt: resolved.startsAt,
        endsAt: resolved.endsAt,
        shortMatchMinutes: resolved.shortMatchMinutes,
        longMatchMinutes: resolved.longMatchMinutes,
        restMinutes: resolved.restMinutes,
        organizerId: resolved.organizerId,
        formatConfig: resolved.formatConfig,
      })
      .returning()

    const tournamentCourts = await tx
      .insert(courts)
      .values(
        Array.from({ length: resolved.courtCount }, (_, index) => ({
          id: randomUUID(),
          tournamentId: tournament.id,
          name: `Cancha ${index + 1}`,
          position: index + 1,
          covered: index < 2,
          enabled: true,
        })),
      )
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
      courtCount: input.courtCount,
    })

    const immutableFields = [
      'date',
      'timezone',
      'startsAt',
      'endsAt',
      'shortMatchMinutes',
      'longMatchMinutes',
      'restMinutes',
      'formatConfig',
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
        ...(input.formatConfig === undefined ? {} : { formatConfig: parseFormatConfig(input.formatConfig) }),
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(tournaments.id, input.id), eq(tournaments.version, input.version)))
      .returning()

    if (!updated) throw new Error('Datos desactualizados')

    if (input.courtCount !== undefined) {
      const existingCourts = await tx.select().from(courts).where(eq(courts.tournamentId, input.id))
      const missing = Array.from({ length: input.courtCount }, (_, index) => index + 1).filter(
        (position) => !existingCourts.some((court) => court.position === position),
      )
      if (missing.length > 0) {
        await tx.insert(courts).values(
          missing.map((position) => ({
            id: randomUUID(),
            tournamentId: input.id,
            name: `Cancha ${position}`,
            position,
            covered: position <= 2,
            enabled: true,
          })),
        )
      }
      await tx.update(courts).set({ enabled: false }).where(eq(courts.tournamentId, input.id))
      await tx
        .update(courts)
        .set({ enabled: true })
        .where(and(eq(courts.tournamentId, input.id), lte(courts.position, input.courtCount)))
      if (updated.state === 'in_progress') {
        await replanPendingMatches(input.id, new Date(), tx)
      }
    }

    const updatedCourts = await tx
      .select()
      .from(courts)
      .where(eq(courts.tournamentId, input.id))
      .orderBy(asc(courts.position))
    return { ...updated, courts: updatedCourts }
  })
}
