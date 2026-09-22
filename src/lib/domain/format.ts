import type { MatchStage } from '@/lib/domain/types'

export type MatchProfile = 'regular' | 'finals'

export interface ProfileFormat {
  games: number
  sets: number
  tieBreak: boolean
  advantage: boolean
}

export interface FormatConfig {
  regular: ProfileFormat
  finals: ProfileFormat
}

export const MIN_GAMES = 4
export const MAX_GAMES = 9
export const SET_OPTIONS = [1, 3, 5] as const

export const DEFAULT_FORMAT_CONFIG: FormatConfig = {
  regular: { games: 6, sets: 1, tieBreak: true, advantage: false },
  finals: { games: 6, sets: 3, tieBreak: true, advantage: true },
}

const FINAL_STAGES: readonly MatchStage[] = ['winners-final', 'losers-final', 'grand-final', 'grand-final-reset']

export function profileForStage(stage: MatchStage): MatchProfile {
  return FINAL_STAGES.includes(stage) ? 'finals' : 'regular'
}

export function defaultFormatConfig(): FormatConfig {
  return {
    regular: { ...DEFAULT_FORMAT_CONFIG.regular },
    finals: { ...DEFAULT_FORMAT_CONFIG.finals },
  }
}

function parseProfile(value: unknown, profile: 'regulares' | 'finales'): ProfileFormat {
  if (!value || typeof value !== 'object') throw new Error(`El formato de los partidos ${profile} es invalido`)
  const candidate = value as Partial<ProfileFormat>
  if (!Number.isInteger(candidate.games) || candidate.games! < MIN_GAMES || candidate.games! > MAX_GAMES) {
    throw new Error('Los juegos por set deben estar entre 4 y 9')
  }
  if (!SET_OPTIONS.includes(candidate.sets as (typeof SET_OPTIONS)[number])) {
    throw new Error('La cantidad de sets debe ser 1, 3 o 5')
  }
  if (typeof candidate.tieBreak !== 'boolean') throw new Error(`El formato de los partidos ${profile} es invalido`)
  const advantage = candidate.tieBreak && candidate.advantage === true
  return { games: candidate.games!, sets: candidate.sets!, tieBreak: candidate.tieBreak, advantage }
}

export function parseFormatConfig(value: unknown): FormatConfig {
  if (!value || typeof value !== 'object') throw new Error('El formato del torneo es invalido')
  const candidate = value as Partial<FormatConfig>
  return {
    regular: parseProfile(candidate.regular, 'regulares'),
    finals: parseProfile(candidate.finals, 'finales'),
  }
}

export function formatLabel(format: ProfileFormat): string {
  const header =
    format.sets === 1 ? `Un set a ${format.games} juegos` : `Al mejor de ${format.sets} sets a ${format.games} juegos`
  if (!format.tieBreak) return `${header}, cierre directo`
  if (!format.advantage) return `${header}, tie-break en ${format.games - 1}-${format.games - 1}`
  return `${header}, con ventaja y tie-break en ${format.games}-${format.games}`
}

export function formatExample(format: ProfileFormat): string {
  const normal = `${format.games}-${format.games - 2}`
  if (!format.tieBreak || !format.advantage) return `${normal} o ${format.games}-${format.games - 1}`
  return `${normal}, ${format.games + 1}-${format.games - 1} o ${format.games + 1}-${format.games}`
}

export function matchDurationMinutes(format: ProfileFormat, shortMinutes: number, longMinutes: number): number {
  return format.sets > 1 ? longMinutes : shortMinutes
}
