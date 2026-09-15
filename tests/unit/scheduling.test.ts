import { describe, expect, it } from 'vitest'
import {
  scheduleReadyMatches,
  type ScheduledMatch,
  type SchedulingInput,
  type SchedulingMatch,
} from '@/lib/domain/scheduling'
import type { MatchFormat } from '@/lib/domain/types'

const MINUTE = 60_000
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 8, 13, hour, minute))

function match(
  id: string,
  participantIds: string[],
  readyAt = at(9),
  format: MatchFormat = 'one-set-nine',
  dependentCount = 0,
): SchedulingMatch {
  return { id, participantIds, readyAt, format, dependentCount }
}

function input(overrides: Partial<SchedulingInput> = {}): SchedulingInput {
  return {
    matches: [],
    courts: [
      { id: 'c1', enabled: true },
      { id: 'c2', enabled: true },
    ],
    tournamentStartsAt: at(9),
    tournamentEndsAt: at(18),
    shortMatchMinutes: 40,
    longMatchMinutes: 90,
    restMinutes: 20,
    ...overrides,
  }
}

function byId(schedule: ScheduledMatch[], matchId: string): ScheduledMatch {
  const entry = schedule.find((scheduled) => scheduled.matchId === matchId)
  if (!entry) throw new Error(`Missing scheduled match ${matchId}`)
  return entry
}

describe('scheduleReadyMatches', () => {
  it('does not overlap a player entered in mixed and men and respects the rest', () => {
    const schedule = scheduleReadyMatches(
      input({
        matches: [match('men-1', ['p1', 'p2', 'p3', 'p4']), match('mixed-1', ['p1', 'p5', 'p6', 'p7'])],
      }),
    )

    const men = byId(schedule, 'men-1')
    const mixed = byId(schedule, 'mixed-1')
    expect(men.startsAt).toEqual(at(9))
    expect(mixed.startsAt.getTime()).toBeGreaterThanOrEqual(men.endsAt.getTime() + 20 * MINUTE)
  })

  it('uses the long duration for a winners final', () => {
    const schedule = scheduleReadyMatches(
      input({ matches: [match('w-final', ['p1', 'p2', 'p3', 'p4'], at(9), 'best-of-three')] }),
    )

    expect(schedule[0].endsAt.getTime() - schedule[0].startsAt.getTime()).toBe(90 * MINUTE)
  })

  it('respects existing court and participant reservations with rest', () => {
    const schedule = scheduleReadyMatches(
      input({
        courtReservations: [{ courtId: 'c1', startsAt: at(9), endsAt: at(9, 40) }],
        participantReservations: [{ participantId: 'p1', startsAt: at(9), endsAt: at(10) }],
        matches: [match('next', ['p1', 'p2', 'p3', 'p4'])],
      }),
    )

    expect(schedule[0].courtId).toBe('c1')
    expect(schedule[0].startsAt).toEqual(at(10, 20))
  })

  it('prioritizes ready matches that unlock more downstream matches', () => {
    const schedule = scheduleReadyMatches(
      input({
        courts: [{ id: 'c1', enabled: true }],
        matches: [
          match('early', ['p1', 'p2', 'p3', 'p4'], at(9), 'one-set-nine', 0),
          match('unlocks-most', ['p5', 'p6', 'p7', 'p8'], at(9), 'one-set-nine', 3),
          match('unlocks-some', ['p9', 'p10', 'p11', 'p12'], at(9), 'one-set-nine', 1),
        ],
      }),
    )

    expect(schedule.map((entry) => entry.matchId)).toEqual(['unlocks-most', 'unlocks-some', 'early'])
    expect(schedule[1].startsAt).toEqual(at(9, 40))
    expect(schedule[2].startsAt).toEqual(at(10, 20))
  })

  it('breaks priority ties by ready order', () => {
    const schedule = scheduleReadyMatches(
      input({
        courts: [{ id: 'c1', enabled: true }],
        matches: [
          match('later', ['p5', 'p6', 'p7', 'p8'], at(9, 10)),
          match('earlier', ['p1', 'p2', 'p3', 'p4'], at(9)),
        ],
      }),
    )

    expect(schedule.map((entry) => entry.matchId)).toEqual(['earlier', 'later'])
    expect(schedule[0].startsAt).toEqual(at(9))
    expect(schedule[1].startsAt).toEqual(at(9, 40))
  })

  it('runs three matches in parallel with three courts and stacks the third with two', () => {
    const matches = [
      match('a', ['p1', 'p2', 'p3', 'p4']),
      match('b', ['p5', 'p6', 'p7', 'p8']),
      match('c', ['p9', 'p10', 'p11', 'p12']),
    ]

    const twoCourts = scheduleReadyMatches(input({ matches }))
    expect(twoCourts.map((entry) => entry.startsAt)).toEqual([at(9), at(9), at(9, 40)])

    const threeCourts = scheduleReadyMatches(
      input({
        courts: [
          { id: 'c1', enabled: true },
          { id: 'c2', enabled: true },
          { id: 'c3', enabled: true },
        ],
        matches,
      }),
    )
    expect(threeCourts.every((entry) => entry.startsAt.getTime() === at(9).getTime())).toBe(true)
  })

  it('never uses a disabled court', () => {
    const schedule = scheduleReadyMatches(
      input({
        courts: [
          { id: 'c1', enabled: true },
          { id: 'c2', enabled: false },
        ],
        matches: [match('a', ['p1', 'p2', 'p3', 'p4']), match('b', ['p5', 'p6', 'p7', 'p8'])],
      }),
    )

    expect(schedule.every((entry) => entry.courtId === 'c1')).toBe(true)
    expect(schedule[1].startsAt).toEqual(at(9, 40))
  })

  it('flags matches that cannot finish before the tournament ends', () => {
    const schedule = scheduleReadyMatches(
      input({
        courts: [{ id: 'c1', enabled: true }],
        tournamentEndsAt: at(10),
        matches: [
          match('short', ['p1', 'p2', 'p3', 'p4']),
          match('long', ['p5', 'p6', 'p7', 'p8'], at(9, 30), 'best-of-three'),
        ],
      }),
    )

    expect(byId(schedule, 'short').afterEndWarning).toBe(false)
    expect(byId(schedule, 'long').startsAt).toEqual(at(9, 40))
    expect(byId(schedule, 'long').afterEndWarning).toBe(true)
  })

  it('reserves the conditional reset after the grand final plus rest', () => {
    const schedule = scheduleReadyMatches(
      input({
        courts: [{ id: 'c1', enabled: true }],
        matches: [match('gf', ['p1', 'p2', 'p3', 'p4'], at(9), 'best-of-three')],
        conditionalResets: [{ id: 'gf-reset', afterMatchId: 'gf' }],
      }),
    )

    const reset = byId(schedule, 'gf-reset')
    expect(reset.conditional).toBe(true)
    expect(reset.startsAt).toEqual(at(10, 50))
    expect(reset.endsAt).toEqual(at(12, 20))
  })

  it('keeps the conditional reset reservation when the grand final is in progress', () => {
    const schedule = scheduleReadyMatches(
      input({
        courts: [{ id: 'c1', enabled: true }],
        matches: [],
        conditionalResets: [
          {
            id: 'gf-reset',
            afterMatchId: 'gf',
            fixedInterval: { startsAt: at(9, 35), endsAt: at(11, 5) },
          },
        ],
      }),
    )

    const reset = byId(schedule, 'gf-reset')
    expect(reset.conditional).toBe(true)
    expect(reset.startsAt).toEqual(at(11, 25))
    expect(reset.endsAt).toEqual(at(12, 55))
  })
})
