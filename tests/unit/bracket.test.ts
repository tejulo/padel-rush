import { describe, expect, it } from 'vitest'
import { buildBracket, isFinalStage, isPowerOfTwo, type BracketMatch } from '@/lib/domain/bracket'

function match(matches: BracketMatch[], key: string): BracketMatch {
  const found = matches.find((entry) => entry.key === key)
  if (!found) throw new Error(`Missing match ${key}`)
  return found
}

describe('double-elimination brackets', () => {
  it('creates a reduced double-elimination bracket for two teams', () => {
    const matches = buildBracket({ categoryId: 'men', teamIds: ['a', 'b'] })

    expect(matches.map((entry) => entry.stage)).toEqual(['winners-final', 'grand-final', 'grand-final-reset'])
    expect(matches.map((entry) => entry.key)).toEqual(['W1-1', 'GF-1', 'GF-reset'])
    expect(match(matches, 'W1-1').slots).toEqual({
      a: { teamId: 'a' },
      b: { teamId: 'b' },
    })
    expect(match(matches, 'W1-1').winnerTo).toEqual({ key: 'GF-1', slot: 'a' })
    expect(match(matches, 'W1-1').loserTo).toEqual({ key: 'GF-1', slot: 'b' })
  })

  it('routes a first-round loser into the losers bracket for four teams', () => {
    const matches = buildBracket({ categoryId: 'men', teamIds: ['a', 'b', 'c', 'd'] })
    const firstRound = match(matches, 'W1-1')

    expect(firstRound.loserTo).toMatchObject({ key: 'L1-1', slot: 'a' })
    expect(match(matches, 'W1-2').loserTo).toMatchObject({ key: 'L1-1', slot: 'b' })
    expect(match(matches, 'W2-1').loserTo).toMatchObject({ key: 'L2-1', slot: 'a' })
    expect(match(matches, 'L1-1').winnerTo).toMatchObject({ key: 'L2-1', slot: 'b' })
    expect(match(matches, 'L2-1').winnerTo).toMatchObject({ key: 'GF-1', slot: 'b' })
    expect(match(matches, 'W2-1').winnerTo).toMatchObject({ key: 'GF-1', slot: 'a' })
  })

  it('creates deterministic winners and losers topology for eight teams', () => {
    const matches = buildBracket({ categoryId: 'men', teamIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })

    expect(matches).toHaveLength(15)
    expect(matches.filter((entry) => entry.stage === 'winners-round')).toHaveLength(6)
    expect(matches.filter((entry) => entry.stage === 'losers-round')).toHaveLength(5)
    expect(matches.filter((entry) => entry.stage === 'losers-final')).toHaveLength(1)
    expect(match(matches, 'L1-1').slots).toMatchObject({
      a: { source: { key: 'W1-1', outcome: 'loser' } },
      b: { source: { key: 'W1-2', outcome: 'loser' } },
    })
    expect(match(matches, 'L2-1').slots).toMatchObject({
      a: { source: { key: 'W2-1', outcome: 'loser' } },
      b: { source: { key: 'L1-1', outcome: 'winner' } },
    })
    expect(match(matches, 'L3-1').slots).toMatchObject({
      a: { source: { key: 'L2-1', outcome: 'winner' } },
      b: { source: { key: 'L2-2', outcome: 'winner' } },
    })
    expect(match(matches, 'L4-1').slots).toMatchObject({
      a: { source: { key: 'W3-1', outcome: 'loser' } },
      b: { source: { key: 'L3-1', outcome: 'winner' } },
    })
  })

  it('exposes bracket predicates', () => {
    expect([2, 4, 8, 16].every(isPowerOfTwo)).toBe(true)
    expect(isPowerOfTwo(1)).toBe(true)
    expect([0, 3, 6].some(isPowerOfTwo)).toBe(false)
    expect(isFinalStage('winners-final')).toBe(true)
    expect(isFinalStage('losers-final')).toBe(true)
    expect(isFinalStage('grand-final')).toBe(true)
    expect(isFinalStage('grand-final-reset')).toBe(true)
    expect(isFinalStage('winners-round')).toBe(false)
  })
})
