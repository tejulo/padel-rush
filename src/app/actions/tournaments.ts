'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import {
  assertTournamentOwner,
  cancelTournament,
  createTournament,
  deleteTournament,
  getTournament,
  regeneratePublicToken,
  updateTournament,
  type CreateTournamentInput,
  type UpdateTournamentInput,
} from '@/lib/services/tournaments'

export type ActionState = { error?: string; success?: string }

function value(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim()
}

function numberValue(formData: FormData, name: string): number | undefined {
  const raw = value(formData, name)
  return raw ? Number(raw) : undefined
}

function courtCount(formData: FormData): 2 | 3 {
  return value(formData, 'enabledCourtCount') === '2' ? 2 : 3
}

function optionalValue(formData: FormData, name: string): string | undefined {
  return formData.has(name) ? value(formData, name) : undefined
}

function errorState(error: unknown): ActionState {
  return { error: error instanceof Error ? error.message : 'No se pudo guardar el torneo' }
}

function tournamentInput(formData: FormData, organizerId: string): CreateTournamentInput {
  return {
    name: value(formData, 'name'),
    date: value(formData, 'date'),
    timezone: value(formData, 'timezone'),
    startsAt: value(formData, 'startsAt'),
    endsAt: value(formData, 'endsAt'),
    shortMatchMinutes: numberValue(formData, 'shortMatchMinutes'),
    longMatchMinutes: numberValue(formData, 'longMatchMinutes'),
    restMinutes: numberValue(formData, 'restMinutes'),
    organizerId,
    enabledCourtCount: formData.has('enabledCourtCount') ? courtCount(formData) : undefined,
  }
}

export async function createTournamentAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const organizerId = user.role === 'admin' ? value(formData, 'organizerId') : user.id
  if (user.role === 'admin' && !organizerId) return { error: 'Selecciona un organizador activo' }
  let tournament
  try {
    tournament = await createTournament(tournamentInput(formData, organizerId))
  } catch (error) {
    return errorState(error)
  }

  revalidatePath('/')
  redirect(`/tournaments/${tournament.id}`)
}

function updateInput(formData: FormData): UpdateTournamentInput {
  const id = value(formData, 'id')
  const version = numberValue(formData, 'version')
  if (!id || version === undefined) throw new Error('Faltan datos de version')
  return {
    id,
    version,
    name: optionalValue(formData, 'name'),
    date: optionalValue(formData, 'date'),
    timezone: optionalValue(formData, 'timezone'),
    startsAt: optionalValue(formData, 'startsAt'),
    endsAt: optionalValue(formData, 'endsAt'),
    shortMatchMinutes: formData.has('shortMatchMinutes') ? numberValue(formData, 'shortMatchMinutes') : undefined,
    longMatchMinutes: formData.has('longMatchMinutes') ? numberValue(formData, 'longMatchMinutes') : undefined,
    restMinutes: formData.has('restMinutes') ? numberValue(formData, 'restMinutes') : undefined,
    enabledCourtCount: formData.has('enabledCourtCount') ? courtCount(formData) : undefined,
  }
}

export async function updateTournamentAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const id = value(formData, 'id')
  const tournament = await getTournament(id)
  if (!tournament) return { error: 'Torneo no encontrado' }

  try {
    assertTournamentOwner(user, tournament)
    await updateTournament(updateInput(formData))
  } catch (error) {
    return errorState(error)
  }

  revalidatePath('/')
  revalidatePath(`/tournaments/${id}`)
  revalidatePath(`/tournaments/${id}/participants`)
  return { success: 'Cambios guardados' }
}

export async function regeneratePublicLinkAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const id = value(formData, 'id')
  const version = numberValue(formData, 'version')
  if (!id || version === undefined) return { error: 'Faltan datos de version' }

  const tournament = await getTournament(id)
  if (!tournament) return { error: 'Torneo no encontrado' }

  try {
    assertTournamentOwner(user, tournament)
    await regeneratePublicToken(id, version)
  } catch (error) {
    return errorState(error)
  }

  revalidatePath(`/tournaments/${id}`)
  return { success: 'Enlace publico regenerado' }
}

function versionFrom(formData: FormData): number | null {
  const id = value(formData, 'id')
  const version = numberValue(formData, 'version')
  return id && version !== undefined ? version : null
}

export async function cancelTournamentAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const id = value(formData, 'id')
  const version = versionFrom(formData)
  if (!id || version === null) return { error: 'Faltan datos de version' }

  const tournament = await getTournament(id)
  if (!tournament) return { error: 'Torneo no encontrado' }

  try {
    assertTournamentOwner(user, tournament)
    await cancelTournament(id, version)
  } catch (error) {
    return errorState(error)
  }

  revalidatePath('/')
  revalidatePath(`/tournaments/${id}`)
  revalidatePath(`/tournaments/${id}/matches`)
  return { success: 'Torneo cancelado' }
}

export async function deleteTournamentAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const id = value(formData, 'id')
  const version = versionFrom(formData)
  if (!id || version === null) return { error: 'Faltan datos de version' }

  const tournament = await getTournament(id)
  if (!tournament) return { error: 'Torneo no encontrado' }

  try {
    assertTournamentOwner(user, tournament)
    await deleteTournament(id, version, user)
  } catch (error) {
    return errorState(error)
  }

  revalidatePath('/')
  redirect('/')
}
