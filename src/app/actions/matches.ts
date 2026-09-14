'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth/guards'
import type { ScoreSet } from '@/lib/domain/scoring'
import { assertTournamentOwner } from '@/lib/services/tournaments'
import type { ActionState } from './tournaments'
import {
  clearResult,
  getMatchContext,
  getTeamContext,
  recordForfeit,
  recordResult,
  startMatch,
  substitutePlayer,
} from '@/lib/services/matches'

export type { ActionState } from './tournaments'

function value(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim()
}

function versionValue(formData: FormData): number {
  const version = Number(value(formData, 'version'))
  if (!Number.isInteger(version) || version < 1) throw new Error('Version invalida')
  return version
}

function errorState(error: unknown): ActionState {
  return { error: error instanceof Error ? error.message : 'No se pudo guardar el resultado' }
}

function scoreValue(formData: FormData): ScoreSet[] {
  const raw = value(formData, 'sets')
  if (!raw) throw new Error('Falta el marcador')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Marcador invalido')
  }
  if (!Array.isArray(parsed)) throw new Error('Marcador invalido')
  return parsed.map((set) => {
    if (!set || typeof set !== 'object') throw new Error('Marcador invalido')
    const home = (set as { home?: unknown }).home
    const away = (set as { away?: unknown }).away
    if (typeof home !== 'number' || typeof away !== 'number' || !Number.isInteger(home) || !Number.isInteger(away)) {
      throw new Error('Marcador invalido')
    }
    return { home, away }
  })
}

async function matchAccess(matchId: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const context = await getMatchContext(matchId)
  if (!context) throw new Error('Partido no encontrado')
  assertTournamentOwner(user, context.tournament)
  return context
}

async function teamAccess(teamId: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const context = await getTeamContext(teamId)
  if (!context) throw new Error('Equipo no encontrado')
  assertTournamentOwner(user, context.tournament)
  return context
}

function revalidateMatchBoard(tournamentId: string, publicToken: string | null): void {
  revalidatePath(`/tournaments/${tournamentId}`)
  revalidatePath(`/tournaments/${tournamentId}/matches`)
  if (publicToken) revalidatePath(`/public/${publicToken}`)
}

export async function startMatchAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const matchId = value(formData, 'matchId')
  let context
  try {
    context = await matchAccess(matchId, user)
    await startMatch(matchId, versionValue(formData))
  } catch (error) {
    return errorState(error)
  }

  revalidateMatchBoard(context.tournament.id, context.tournament.publicToken)
  return { success: 'Partido iniciado' }
}

export async function recordResultAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const matchId = value(formData, 'matchId')
  let context
  try {
    context = await matchAccess(matchId, user)
    await recordResult({ matchId, version: versionValue(formData), sets: scoreValue(formData) })
  } catch (error) {
    return errorState(error)
  }

  revalidateMatchBoard(context.tournament.id, context.tournament.publicToken)
  return { success: 'Resultado guardado' }
}

export async function recordForfeitAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const matchId = value(formData, 'matchId')
  const reason = value(formData, 'reason')
  let context
  try {
    context = await matchAccess(matchId, user)
    if (reason !== 'absence' && reason !== 'retirement') throw new Error('Motivo de derrota automatica invalido')
    await recordForfeit({
      matchId,
      version: versionValue(formData),
      reason,
      forfeitTeamId: value(formData, 'forfeitTeamId'),
    })
  } catch (error) {
    return errorState(error)
  }

  revalidateMatchBoard(context.tournament.id, context.tournament.publicToken)
  return { success: 'Derrota automatica guardada' }
}

export async function clearResultAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const matchId = value(formData, 'matchId')
  let context
  try {
    context = await matchAccess(matchId, user)
    await clearResult(matchId, versionValue(formData))
  } catch (error) {
    return errorState(error)
  }

  revalidateMatchBoard(context.tournament.id, context.tournament.publicToken)
  return { success: 'Resultado corregido' }
}

export async function substitutePlayerAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()
  const teamId = value(formData, 'teamId')
  let context
  try {
    context = await teamAccess(teamId, user)
    const rawVersion = value(formData, 'version')
    await substitutePlayer({
      teamId,
      outgoingParticipantId: value(formData, 'outgoingParticipantId'),
      replacementParticipantId: value(formData, 'replacementParticipantId'),
      ...(rawVersion ? { version: versionValue(formData) } : {}),
    })
  } catch (error) {
    return errorState(error)
  }

  revalidateMatchBoard(context.tournament.id, context.tournament.publicToken)
  return { success: 'Sustitucion guardada' }
}
