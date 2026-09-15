import { describe, expect, it } from 'vitest'
import { validateScore } from '@/lib/domain/scoring'

describe('score validation', () => {
  it('accepts short winning scores and rejects a score without nine games', () => {
    expect(validateScore('one-set-nine', [{ home: 9, away: 8 }]).ok).toBe(true)
    expect(validateScore('one-set-nine', [{ home: 9, away: 7 }]).ok).toBe(true)
    expect(validateScore('one-set-nine', [{ home: 8, away: 7 }]).ok).toBe(false)
  })

  it('accepts a best-of-three result after two winning sets', () => {
    expect(validateScore('best-of-three', [{ home: 6, away: 4 }, { home: 7, away: 6 }]).ok).toBe(true)
  })

  it('accepts either side winning a legal short match', () => {
    expect(validateScore('one-set-nine', [{ home: 0, away: 9 }]).ok).toBe(true)
    expect(validateScore('one-set-nine', [{ home: 8, away: 9 }]).ok).toBe(true)
    expect(validateScore('one-set-nine', [{ home: 9, away: 9 }]).ok).toBe(false)
    expect(validateScore('one-set-nine', [{ home: 10, away: 8 }]).ok).toBe(false)
  })

  it('requires exactly two winning sets and legal long sets', () => {
    expect(validateScore('best-of-three', [{ home: 6, away: 0 }, { home: 6, away: 4 }, { home: 0, away: 6 }]).ok).toBe(false)
    expect(validateScore('best-of-three', [{ home: 6, away: 5 }, { home: 6, away: 0 }]).ok).toBe(false)
    expect(validateScore('best-of-three', [{ home: 7, away: 6 }, { home: 4, away: 6 }, { home: 6, away: 2 }]).ok).toBe(true)
  })

  it('accepts a two-game margin at 7-5 but rejects 7-4 and unfinished set counts', () => {
    expect(validateScore('best-of-three', [{ home: 5, away: 7 }, { home: 6, away: 4 }, { home: 7, away: 5 }]).ok).toBe(true)
    expect(validateScore('best-of-three', [{ home: 7, away: 5 }, { home: 7, away: 5 }]).ok).toBe(true)
    expect(validateScore('best-of-three', [{ home: 7, away: 4 }, { home: 6, away: 0 }]).ok).toBe(false)
    expect(validateScore('best-of-three', [{ home: 8, away: 6 }, { home: 6, away: 0 }]).ok).toBe(false)
    expect(validateScore('best-of-three', [{ home: 7, away: 5 }]).ok).toBe(false)
    expect(validateScore('best-of-three', [{ home: 7, away: 5 }, { home: 6, away: 4 }, { home: 0, away: 6 }]).ok).toBe(false)
  })
})
