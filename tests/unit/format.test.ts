import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FORMAT_CONFIG,
  defaultFormatConfig,
  formatExample,
  formatLabel,
  parseFormatConfig,
  profileForStage,
} from '@/lib/domain/format'

describe('format config', () => {
  it('reproduces the current rules as defaults', () => {
    expect(DEFAULT_FORMAT_CONFIG).toEqual({
      regular: { games: 9, sets: 1, tieBreak: true, advantage: false },
      finals: { games: 6, sets: 3, tieBreak: true, advantage: true },
    })
    expect(defaultFormatConfig()).toEqual(DEFAULT_FORMAT_CONFIG)
  })

  it('accepts valid configs and normalizes advantage without tie-break', () => {
    const parsed = parseFormatConfig({
      regular: { games: 6, sets: 1, tieBreak: false, advantage: true },
      finals: { games: 8, sets: 5, tieBreak: true, advantage: true },
    })
    expect(parsed.regular).toEqual({ games: 6, sets: 1, tieBreak: false, advantage: false })
    expect(parsed.finals).toEqual({ games: 8, sets: 5, tieBreak: true, advantage: true })
  })

  it('rejects out-of-range games, sets and shapes', () => {
    expect(() =>
      parseFormatConfig({ regular: { games: 3, sets: 1, tieBreak: true, advantage: false }, finals: DEFAULT_FORMAT_CONFIG.finals }),
    ).toThrow('Los juegos por set deben estar entre 4 y 9')
    expect(() =>
      parseFormatConfig({ regular: { games: 6, sets: 2, tieBreak: true, advantage: false }, finals: DEFAULT_FORMAT_CONFIG.finals }),
    ).toThrow('La cantidad de sets debe ser 1, 3 o 5')
    expect(() => parseFormatConfig(null)).toThrow('El formato del torneo es invalido')
  })

  it('labels and examples derive from the config', () => {
    expect(formatLabel(DEFAULT_FORMAT_CONFIG.regular)).toBe('Un set a 9 juegos, tie-break en 8-8')
    expect(formatLabel(DEFAULT_FORMAT_CONFIG.finals)).toBe('Al mejor de 3 sets a 6 juegos, con ventaja y tie-break en 6-6')
    expect(formatLabel({ games: 6, sets: 1, tieBreak: false, advantage: false })).toBe('Un set a 6 juegos, cierre directo')
    expect(formatExample(DEFAULT_FORMAT_CONFIG.regular)).toBe('9-7 o 9-8')
    expect(formatExample(DEFAULT_FORMAT_CONFIG.finals)).toBe('6-4, 7-5 o 7-6')
  })

  it('maps final stages to the finals profile', () => {
    expect(profileForStage('grand-final')).toBe('finals')
    expect(profileForStage('grand-final-reset')).toBe('finals')
    expect(profileForStage('winners-final')).toBe('finals')
    expect(profileForStage('losers-final')).toBe('finals')
    expect(profileForStage('winners-round')).toBe('regular')
    expect(profileForStage('losers-round')).toBe('regular')
  })
})
