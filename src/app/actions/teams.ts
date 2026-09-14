'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/guards'
import type { ActionState } from '@/app/actions/tournaments'
import { assertTournamentOwner, getTournament } from '@/lib/services/tournaments'
import {
  cancelCategory,
  getTournamentTeams,
  lockTeams,
  returnTournamentToDraft,
  saveTeams,
  type DraftTeamInput,
} from '@/lib/services/teams'

export type { ActionState } from '@/app/actions/tournaments'

function value(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim()
}

function numberValue(formData: FormData, name: string): number {
  const number = Number(value(formData, name))
  if (!Number.isInteger(number)) throw new Error('Version invalida')
  return number
}

function errorState(error: unknown): ActionState {
  return { error: error instanceof Error ? error.message : 'No se pudo guardar la formacion de equipos' }
}

async function assertAccess(user: Awaited<ReturnType<typeof requireUser>>, tournamentId: string) {
  const tournament = await getTournament(tournamentId)
  if (!tournament) throw new Error('Torneo no encontrado')
  assertTournamentOwner(user, tournament)
  return tournament
}

function draftTeamsValue(formData: FormData): DraftTeamInput[] {
  const raw = value(formData, 'teams')
  if (!raw) throw new Error('Faltan equipos')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Equipos invalidos')
  }
  if (!Array.isArray(parsed)) throw new Error('Equipos invalidos')

  return parsed.map((team) => {
    if (!team || typeof team !== 'object' || !Array.isArray((team as { memberIds?: unknown }).memberIds)) {
      throw new Error('Equipos invalidos')
    }
    const memberIds = (team as { memberIds: unknown[] }).memberIds
    if (memberIds.some((memberId) => typeof memberId !== 'string' || !memberId.trim())) {
      throw new Error('Equipos invalidos')
    }
    const name = (team as { name?: unknown }).name
    return {
      memberIds: memberIds.map((memberId) => (memberId as string).trim()),
      ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}),
    }
  })
}

async function assertCategoryAccess(
  user: Awaited<ReturnType<typeof requireUser>>,
  tournamentId: string,
  categoryId: string,
) {
  const tournament = await assertAccess(user, tournamentId)
  const category = (await getTournamentTeams(tournament.id)).find((item) => item.id === categoryId)
  if (!category) throw new Error('Categoria no encontrada')
  return { tournament, category }
}

export async function saveTeamsAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const tournamentId = value(formData, 'tournamentId')
  const categoryId = value(formData, 'categoryId')
  try {
    await assertCategoryAccess(user, tournamentId, categoryId)
    await saveTeams(categoryId, draftTeamsValue(formData), numberValue(formData, 'version'))
  } catch (error) {
    return errorState(error)
  }

  revalidatePath(`/tournaments/${tournamentId}`)
  revalidatePath(`/tournaments/${tournamentId}/teams`)
  return { success: 'Equipos guardados' }
}

export async function lockTeamsAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const tournamentId = value(formData, 'tournamentId')
  try {
    await assertAccess(user, tournamentId)
    await lockTeams(tournamentId)
  } catch (error) {
    return errorState(error)
  }

  revalidatePath(`/tournaments/${tournamentId}`)
  revalidatePath(`/tournaments/${tournamentId}/teams`)
  return { success: 'Equipos bloqueados' }
}

export async function cancelCategoryAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const tournamentId = value(formData, 'tournamentId')
  const categoryId = value(formData, 'categoryId')
  try {
    const { category } = await assertCategoryAccess(user, tournamentId, categoryId)
    await cancelCategory(category.id, numberValue(formData, 'version'))
  } catch (error) {
    return errorState(error)
  }

  revalidatePath(`/tournaments/${tournamentId}`)
  revalidatePath(`/tournaments/${tournamentId}/teams`)
  return { success: 'Categoria cancelada' }
}

export async function returnTournamentToDraftAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser()
  const tournamentId = value(formData, 'tournamentId')
  try {
    await assertAccess(user, tournamentId)
    await returnTournamentToDraft(tournamentId)
  } catch (error) {
    return errorState(error)
  }

  revalidatePath(`/tournaments/${tournamentId}`)
  revalidatePath(`/tournaments/${tournamentId}/teams`)
  return { success: 'El torneo volvio a borrador' }
}
