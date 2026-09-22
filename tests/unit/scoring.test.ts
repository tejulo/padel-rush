import { describe, expect, it } from 'vitest'
import type { ProfileFormat } from '@/lib/domain/format'
import { scoreFormConfig, validateScore } from '@/lib/domain/scoring'

const regular: ProfileFormat = { games: 9, sets: 1, tieBreak: true, advantage: false }
const finals: ProfileFormat = { games: 6, sets: 3, tieBreak: true, advantage: true }
const directSix: ProfileFormat = { games: 6, sets: 1, tieBreak: false, advantage: false }
const bestOfFive: ProfileFormat = { games: 6, sets: 5, tieBreak: true, advantage: true }

describe('score validation', () => {
  it('accepts the relampago regular set and rejects anything above nine games', () => {
    expect(validateScore(regular, [{ home: 9, away: 8 }]).ok).toBe(true)
    expect(validateScore(regular, [{ home: 9, away: 7 }]).ok).toBe(true)
    expect(validateScore(regular, [{ home: 8, away: 7 }]).ok).toBe(false)
    expect(validateScore(regular, [{ home: 10, away: 8 }]).ok).toBe(false)
    expect(validateScore(regular, [{ home: 9, away: 9 }]).ok).toBe(false)
  })

  it('accepts tennis sets with advantage and tie-break', () => {
    expect(validateScore(finals, [{ home: 6, away: 4 }, { home: 7, away: 6 }]).ok).toBe(true)
    expect(validateScore(finals, [{ home: 7, away: 5 }, { home: 6, away: 4 }]).ok).toBe(true)
    expect(validateScore(finals, [{ home: 6, away: 5 }, { home: 6, away: 4 }]).ok).toBe(false)
    expect(validateScore(finals, [{ home: 8, away: 6 }, { home: 6, away: 0 }]).ok).toBe(false)
  })

  it('closes directly when the tie-break is off', () => {
    expect(validateScore(directSix, [{ home: 6, away: 5 }]).ok).toBe(true)
    expect(validateScore(directSix, [{ home: 6, away: 4 }]).ok).toBe(true)
    expect(validateScore(directSix, [{ home: 7, away: 6 }]).ok).toBe(false)
    expect(validateScore(directSix, [{ home: 6, away: 5 }, { home: 6, away: 5 }]).ok).toBe(false)
  })

  it('requires the needed sets and rejects dead sets', () => {
    expect(validateScore(finals, [{ home: 6, away: 0 }, { home: 6, away: 4 }, { home: 0, away: 6 }]).ok).toBe(false)
    expect(validateScore(finals, [{ home: 7, away: 6 }, { home: 4, away: 6 }, { home: 6, away: 2 }]).ok).toBe(true)
    expect(validateScore(bestOfFive, [{ home: 6, away: 0 }, { home: 6, away: 4 }, { home: 6, away: 2 }]).ok).toBe(true)
    expect(validateScore(bestOfFive, [{ home: 6, away: 0 }, { home: 6, away: 4 }, { home: 6, away: 2 }, { home: 6, away: 1 }]).ok).toBe(false)
    expect(validateScore(bestOfFive, [{ home: 6, away: 0 }, { home: 6, away: 4 }]).ok).toBe(false)
  })
})

describe('score form configuration', () => {
  it('derives the set options and the maximum game count', () => {
    expect(scoreFormConfig(regular)).toEqual({ setOptions: [1], maxGames: 9 })
    expect(scoreFormConfig(finals)).toEqual({ setOptions: [2, 3], maxGames: 7 })
    expect(scoreFormConfig(directSix)).toEqual({ setOptions: [1], maxGames: 6 })
    expect(scoreFormConfig(bestOfFive)).toEqual({ setOptions: [3, 4, 5], maxGames: 7 })
  })
})
