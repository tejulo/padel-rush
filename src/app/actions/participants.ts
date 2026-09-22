'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/guards'
import type { Category, Gender } from '@/lib/domain/types'
import { assertTournamentOwner, getTournament } from '@/lib/services/tournaments'
import {
  createParticipant,
  deleteParticipant,
  getParticipant,
  updateParticipant,
  replaceRegistrations,
  type CreateParticipantInput,
  type UpdateParticipantInput,
} from '@/lib/services/participants'
import type { ActionState } from './tournaments'

export type { ActionState } from './tournaments'

const validCategories: Category[] = ['men', 'women', 'mixed']

function value(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim()
}

function numberValue(formData: FormData, name: string): number {
  return Number(value(formData, name))
}

function genderValue(formData: FormData): Gender {
  const gender = value(formData, 'gender')
  if (gender !== 'man' && gender !== 'woman') throw new Error('Genero invalido')
  return gender
}

function categoriesValue(formData: FormData): Category[] {
  const selected = formData.getAll('categories').map(String)
  if (selected.some((category) => !validCategories.includes(category as Category))) {
    throw new Error('Categoria invalida')
  }
  return selected as Category[]
}

function errorState(error: unknown): ActionState {
  return { error: error instanceof Error ? error.message : 'No se pudo guardar el participante' }
}

async function assertAccess(user: Awaited<ReturnType<typeof requireUser>>, tournamentId: string) {
  const tournament = await getTournament(tournamentId)
  if (!tournament) throw new Error('Torneo no encontrado')
  assertTournamentOwner(user, tournament)
  return tournament
}

function createInput(formData: FormData): CreateParticipantInput {
  return {
    tournamentId: value(formData, 'tournamentId'),
    name: value(formData, 'name'),
    gender: genderValue(formData),
    level: numberValue(formData, 'level'),
    categories: categoriesValue(formData),
  }
}

export async function createParticipantAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const tournamentId = value(formData, 'tournamentId')
  try {
    await assertAccess(user, tournamentId)
    await createParticipant(createInput(formData))
  } catch (error) {
    return errorState(error)
  }

  revalidatePath(`/tournaments/${tournamentId}/participants`)
  return { success: 'Participante agregado' }
}

function updateInput(formData: FormData): UpdateParticipantInput {
  const id = value(formData, 'id')
  const version = numberValue(formData, 'version')
  if (!id || !Number.isInteger(version)) throw new Error('Faltan datos de version')
  return {
    id,
    version,
    name: value(formData, 'name'),
    gender: genderValue(formData),
    level: numberValue(formData, 'level'),
    categories: categoriesValue(formData),
  }
}

export async function updateParticipantAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const participantId = value(formData, 'id')
  const participant = await getParticipant(participantId)
  if (!participant) return { error: 'Participante no encontrado' }

  try {
    await assertAccess(user, participant.tournamentId)
    await updateParticipant(updateInput(formData))
  } catch (error) {
    return errorState(error)
  }

  revalidatePath(`/tournaments/${participant.tournamentId}/participants`)
  return { success: 'Participante actualizado' }
}

export async function deleteParticipantAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const participantId = value(formData, 'id')
  const participant = await getParticipant(participantId)
  if (!participant) return { error: 'Participante no encontrado' }

  try {
    await assertAccess(user, participant.tournamentId)
    await deleteParticipant(participantId, numberValue(formData, 'version'))
  } catch (error) {
    return errorState(error)
  }

  revalidatePath(`/tournaments/${participant.tournamentId}/participants`)
  revalidatePath(`/tournaments/${participant.tournamentId}/teams`)
  return { success: 'Participante eliminado' }
}

export async function replaceRegistrationsAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const participantId = value(formData, 'participantId')
  const participant = await getParticipant(participantId)
  if (!participant) return { error: 'Participante no encontrado' }
  try {
    await assertAccess(user, participant.tournamentId)
    const version = numberValue(formData, 'version')
    await replaceRegistrations(participantId, categoriesValue(formData), version)
  } catch (error) {
    return errorState(error)
  }

  revalidatePath(`/tournaments/${participant.tournamentId}/participants`)
  return { success: 'Inscripciones actualizadas' }
}
