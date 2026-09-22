import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  categories,
  participants,
  registrations,
  type Participant,
} from '@/lib/db/schema'
import { validateParticipant } from '@/lib/domain/validation'
import type { Category, Gender } from '@/lib/domain/types'
import { lockTournamentForWrite, type TournamentTransaction } from '@/lib/services/tournaments'

export interface CreateParticipantInput {
  tournamentId: string
  name: string
  gender: Gender
  level: number
  categories: Category[]
}

export interface UpdateParticipantInput {
  id: string
  version: number
  name: string
  gender: Gender
  level: number
  categories: Category[]
}

export type ParticipantWithCategories = Participant & { categories: Category[] }

function assertValidParticipant(input: Omit<CreateParticipantInput, 'tournamentId'>): void {
  const result = validateParticipant(input)
  if (!result.ok) throw new Error(result.message)
}

async function getEditableTournament(tx: TournamentTransaction, tournamentId: string) {
  const { tournament, tournamentCategories } = await lockTournamentForWrite(tx, tournamentId)
  if (tournament.state !== 'draft') throw new Error('El torneo no admite cambios')
  if (tournamentCategories.some((category) => category.state !== 'draft' && category.state !== 'cancelled')) {
    throw new Error('El torneo no admite cambios')
  }

  return { tournament, tournamentCategories }
}

function categoryIds(
  requested: Category[],
  available: typeof categories.$inferSelect[],
): string[] {
  const rows = requested.map((category) => available.find((row) => row.category === category))
  if (rows.some((row) => !row)) throw new Error('Categoria no encontrada')
  if (rows.some((row) => row!.state === 'cancelled')) throw new Error('La categoria fue cancelada')
  return rows.map((row) => row!.id)
}

async function writeRegistrations(
  tx: TournamentTransaction,
  participantId: string,
  requested: Category[],
  available: typeof categories.$inferSelect[],
): Promise<void> {
  await tx.delete(registrations).where(eq(registrations.participantId, participantId))
  const ids = categoryIds(requested, available)
  if (ids.length > 0) {
    await tx.insert(registrations).values(ids.map((categoryId) => ({ id: randomUUID(), participantId, categoryId })))
  }
}

export async function createParticipant(input: CreateParticipantInput): Promise<Participant> {
  assertValidParticipant(input)

  return db.transaction(async (tx) => {
    const { tournamentCategories } = await getEditableTournament(tx, input.tournamentId)
    const [participant] = await tx
      .insert(participants)
      .values({
        id: randomUUID(),
        tournamentId: input.tournamentId,
        name: input.name.trim(),
        gender: input.gender,
        level: input.level,
      })
      .returning()

    await writeRegistrations(tx, participant.id, input.categories, tournamentCategories)
    return participant
  })
}

export async function replaceRegistrations(
  participantId: string,
  requested: Category[],
  version: number,
): Promise<Participant> {
  return db.transaction(async (tx) => {
    const [participant] = await tx.select().from(participants).where(eq(participants.id, participantId)).limit(1)
    if (!participant) throw new Error('Participante no encontrado')
    const { tournamentCategories } = await getEditableTournament(tx, participant.tournamentId)
    assertValidParticipant({
      name: participant.name,
      gender: participant.gender,
      level: participant.level,
      categories: requested,
    })

    const [updated] = await tx
      .update(participants)
      .set({ version: participant.version + 1, updatedAt: new Date() })
      .where(and(eq(participants.id, participantId), eq(participants.version, version)))
      .returning()
    if (!updated) throw new Error('Datos desactualizados')

    await writeRegistrations(tx, participantId, requested, tournamentCategories)
    return updated
  })
}

export async function updateParticipant(input: UpdateParticipantInput): Promise<Participant> {
  assertValidParticipant(input)

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(participants).where(eq(participants.id, input.id)).limit(1)
    if (!current) throw new Error('Participante no encontrado')
    const { tournamentCategories } = await getEditableTournament(tx, current.tournamentId)

    const [updated] = await tx
      .update(participants)
      .set({
        name: input.name.trim(),
        gender: input.gender,
        level: input.level,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(participants.id, input.id), eq(participants.version, input.version)))
      .returning()
    if (!updated) throw new Error('Datos desactualizados')

    await writeRegistrations(tx, input.id, input.categories, tournamentCategories)
    return updated
  })
}

export async function deleteParticipant(participantId: string, version: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [participant] = await tx.select().from(participants).where(eq(participants.id, participantId)).limit(1)
    if (!participant) throw new Error('Participante no encontrado')
    await getEditableTournament(tx, participant.tournamentId)
    if (!Number.isInteger(version) || version !== participant.version) throw new Error('Datos desactualizados')
    await tx.delete(participants).where(and(eq(participants.id, participantId), eq(participants.version, version)))
  })
}

export async function getParticipants(tournamentId: string): Promise<ParticipantWithCategories[]> {
  const participantRows = await db
    .select()
    .from(participants)
    .where(eq(participants.tournamentId, tournamentId))
    .orderBy(asc(participants.name))
  const registrationRows = await db
    .select({ participantId: registrations.participantId, category: categories.category })
    .from(registrations)
    .innerJoin(categories, eq(registrations.categoryId, categories.id))
    .where(eq(categories.tournamentId, tournamentId))

  return participantRows.map((participant) => ({
    ...participant,
    categories: registrationRows
      .filter((registration) => registration.participantId === participant.id)
      .map((registration) => registration.category),
  }))
}

export async function getParticipant(participantId: string): Promise<ParticipantWithCategories | null> {
  const [participant] = await db.select().from(participants).where(eq(participants.id, participantId)).limit(1)
  if (!participant) return null
  const rows = await db
    .select({ category: categories.category })
    .from(registrations)
    .innerJoin(categories, eq(registrations.categoryId, categories.id))
    .where(eq(registrations.participantId, participantId))
  return { ...participant, categories: rows.map((row) => row.category) }
}
