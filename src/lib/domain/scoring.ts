import type { ProfileFormat } from '@/lib/domain/format'

export interface ScoreSet {
  home: number
  away: number
}

export type ScoreValidation =
  | { ok: true; winner: 'home' | 'away' }
  | { ok: false; message: string }

function isGameScore(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

function validSet(set: ScoreSet, format: ProfileFormat): boolean {
  if (!set || typeof set !== 'object') return false
  if (!isGameScore(set.home) || !isGameScore(set.away)) return false
  const winner = Math.max(set.home, set.away)
  const loser = Math.min(set.home, set.away)
  if (format.tieBreak && format.advantage) {
    return (
      (winner === format.games && loser <= format.games - 2) ||
      (winner === format.games + 1 && (loser === format.games - 1 || loser === format.games))
    )
  }
  return winner === format.games && loser <= format.games - 1
}

export interface ScoreFormConfig {
  setOptions: number[]
  maxGames: number
}

export function scoreFormConfig(format: ProfileFormat): ScoreFormConfig {
  const needed = Math.ceil(format.sets / 2)
  const setOptions =
    format.sets === 1 ? [1] : Array.from({ length: format.sets - needed + 1 }, (_, index) => needed + index)
  return { setOptions, maxGames: format.games + (format.tieBreak && format.advantage ? 1 : 0) }
}

export function validateScore(format: ProfileFormat, sets: readonly ScoreSet[]): ScoreValidation {
  if (!Array.isArray(sets)) return { ok: false, message: 'El marcador no es valido' }
  const needed = Math.ceil(format.sets / 2)
  if (sets.length < needed || sets.length > format.sets) return { ok: false, message: 'La cantidad de sets no es valida' }
  if (sets.some((set) => !validSet(set, format))) return { ok: false, message: 'El marcador no es valido' }

  const homeSets = sets.filter((set) => set.home > set.away).length
  const awaySets = sets.length - homeSets
  if (homeSets === awaySets) return { ok: false, message: 'El marcador debe tener un ganador' }
  if (Math.max(homeSets, awaySets) !== needed) {
    return { ok: false, message: `La serie debe tener ${needed} sets ganados` }
  }

  const winner = homeSets > awaySets ? 'home' : 'away'
  const lastSet = sets[sets.length - 1]!
  const lastWinner = lastSet.home > lastSet.away ? 'home' : 'away'
  if (lastWinner !== winner) return { ok: false, message: 'La serie termino antes del ultimo set' }

  return { ok: true, winner }
}
