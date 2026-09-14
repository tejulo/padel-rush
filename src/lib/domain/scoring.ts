import type { MatchFormat } from '@/lib/domain/types'

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

function validShortSet(set: ScoreSet): boolean {
  if (!set || typeof set !== 'object') return false
  if (!isGameScore(set.home) || !isGameScore(set.away)) return false
  const winner = Math.max(set.home, set.away)
  const loser = Math.min(set.home, set.away)
  return winner === 9 && (loser <= 7 || loser === 8)
}

function validLongSet(set: ScoreSet): boolean {
  if (!set || typeof set !== 'object') return false
  if (!isGameScore(set.home) || !isGameScore(set.away)) return false
  const winner = Math.max(set.home, set.away)
  const loser = Math.min(set.home, set.away)
  return (winner === 6 && loser <= 4) || (winner === 7 && (loser === 5 || loser === 6))
}

export function validateScore(format: MatchFormat, sets: readonly ScoreSet[]): ScoreValidation {
  if (format !== 'one-set-nine' && format !== 'best-of-three') return { ok: false, message: 'Formato de partido invalido' }
  if (!Array.isArray(sets)) return { ok: false, message: 'El marcador no es valido' }
  const validLength = format === 'one-set-nine' ? sets.length === 1 : sets.length === 2 || sets.length === 3
  if (!validLength) return { ok: false, message: 'La cantidad de sets no es valida' }

  const validSet = format === 'one-set-nine' ? validShortSet : validLongSet
  if (sets.some((set) => !validSet(set))) return { ok: false, message: 'El marcador no es valido' }

  if (format === 'best-of-three' && sets.length === 3) {
    const firstTwoHomeWins = sets.slice(0, 2).filter((set) => set.home > set.away).length
    if (firstTwoHomeWins === 0 || firstTwoHomeWins === 2) {
      return { ok: false, message: 'La serie termino antes del ultimo set' }
    }
  }

  const homeSets = sets.filter((set) => set.home > set.away).length
  const awaySets = sets.length - homeSets
  if (homeSets === awaySets) return { ok: false, message: 'El marcador debe tener un ganador' }
  if (format === 'best-of-three' && Math.max(homeSets, awaySets) !== 2) {
    return { ok: false, message: 'La serie debe tener dos sets ganados' }
  }

  return { ok: true, winner: homeSets > awaySets ? 'home' : 'away' }
}
