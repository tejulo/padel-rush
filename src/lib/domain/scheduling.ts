import type { MatchFormat } from '@/lib/domain/types'

export interface SchedulingMatch {
  id: string
  format: MatchFormat
  participantIds: readonly string[]
  readyAt: Date
  dependentCount?: number
}

export interface SchedulingCourt {
  id: string
  enabled: boolean
}

export interface SchedulingInterval {
  startsAt: Date
  endsAt: Date
}

export interface CourtReservation extends SchedulingInterval {
  courtId: string
}

export interface ParticipantReservation extends SchedulingInterval {
  participantId: string
}

export interface ConditionalReset {
  id: string
  afterMatchId: string
}

export interface SchedulingInput {
  matches: readonly SchedulingMatch[]
  courts: readonly SchedulingCourt[]
  tournamentStartsAt: Date
  tournamentEndsAt: Date
  shortMatchMinutes: number
  longMatchMinutes: number
  restMinutes: number
  courtReservations?: readonly CourtReservation[]
  participantReservations?: readonly ParticipantReservation[]
  conditionalResets?: readonly ConditionalReset[]
}

export interface ScheduledMatch {
  matchId: string
  courtId: string
  startsAt: Date
  endsAt: Date
  afterEndWarning: boolean
  conditional: boolean
}

const MINUTE = 60_000

function byPriority(a: SchedulingMatch, b: SchedulingMatch): number {
  const dependents = (b.dependentCount ?? 0) - (a.dependentCount ?? 0)
  if (dependents !== 0) return dependents
  return a.readyAt.getTime() - b.readyAt.getTime()
}

function overlaps(start: number, end: number, blockStart: number, blockEnd: number): boolean {
  return start < blockEnd && blockStart < end
}

interface BookedInterval {
  courtId: string
  startsAt: number
  endsAt: number
  participantIds: readonly string[]
}

function participantBlocks(
  booked: readonly BookedInterval[],
  participantId: string,
  rest: number,
): { startsAt: number; endsAt: number }[] {
  return booked
    .filter((entry) => entry.participantIds.includes(participantId))
    .map((entry) => ({ startsAt: entry.startsAt - rest, endsAt: entry.endsAt + rest }))
}

function nextStart(
  courtId: string,
  from: number,
  duration: number,
  participantIds: readonly string[],
  input: SchedulingInput,
  booked: readonly BookedInterval[],
): number {
  const rest = input.restMinutes * MINUTE
  const end = () => start + duration
  let start = from

  for (;;) {
    let blockedUntil = start
    for (const entry of booked) {
      if (entry.courtId !== courtId) continue
      if (overlaps(start, end(), entry.startsAt, entry.endsAt)) {
        blockedUntil = Math.max(blockedUntil, entry.endsAt)
      }
    }
    for (const reservation of input.courtReservations ?? []) {
      if (reservation.courtId !== courtId) continue
      if (overlaps(start, end(), reservation.startsAt.getTime(), reservation.endsAt.getTime())) {
        blockedUntil = Math.max(blockedUntil, reservation.endsAt.getTime())
      }
    }
    for (const participantId of participantIds) {
      const reservations = [
        ...participantBlocks(booked, participantId, rest),
        ...(input.participantReservations ?? [])
          .filter((reservation) => reservation.participantId === participantId)
          .map((reservation) => ({
            startsAt: reservation.startsAt.getTime() - rest,
            endsAt: reservation.endsAt.getTime() + rest,
          })),
      ]
      for (const reservation of reservations) {
        if (overlaps(start, end(), reservation.startsAt, reservation.endsAt)) {
          blockedUntil = Math.max(blockedUntil, reservation.endsAt)
        }
      }
    }
    if (blockedUntil <= start) return start
    start = blockedUntil
  }
}

function book(
  courtId: string,
  start: number,
  duration: number,
  participantIds: readonly string[],
): BookedInterval {
  return { courtId, startsAt: start, endsAt: start + duration, participantIds }
}

function scheduleInterval(
  input: SchedulingInput,
  earliest: number,
  duration: number,
  participantIds: readonly string[],
  booked: readonly BookedInterval[],
): { courtId: string; startsAt: number; endsAt: number } | null {
  const enabled = input.courts.filter((court) => court.enabled)
  let best: { courtId: string; startsAt: number; endsAt: number } | null = null

  for (const court of enabled) {
    const start = nextStart(court.id, earliest, duration, participantIds, input, booked)
    if (!best || start < best.startsAt) best = { courtId: court.id, startsAt: start, endsAt: start + duration }
  }
  return best
}

export function scheduleReadyMatches(input: SchedulingInput): ScheduledMatch[] {
  const sorted = [...input.matches].sort(byPriority)
  if (sorted.length > 0 && input.courts.every((court) => !court.enabled)) {
    throw new Error('No hay canchas habilitadas')
  }

  const booked: BookedInterval[] = []
  const scheduled: ScheduledMatch[] = []
  const startFloor = input.tournamentStartsAt.getTime()
  const endLimit = input.tournamentEndsAt.getTime()

  for (const match of sorted) {
    const duration =
      (match.format === 'best-of-three' ? input.longMatchMinutes : input.shortMatchMinutes) * MINUTE
    const earliest = Math.max(startFloor, match.readyAt.getTime())
    const slot = scheduleInterval(input, earliest, duration, match.participantIds, booked)
    if (!slot) throw new Error(`No se pudo programar el partido ${match.id}`)

    booked.push(book(slot.courtId, slot.startsAt, duration, match.participantIds))
    scheduled.push({
      matchId: match.id,
      courtId: slot.courtId,
      startsAt: new Date(slot.startsAt),
      endsAt: new Date(slot.endsAt),
      afterEndWarning: slot.endsAt > endLimit,
      conditional: false,
    })
  }

  const duration = input.longMatchMinutes * MINUTE
  const rest = input.restMinutes * MINUTE
  for (const reset of input.conditionalResets ?? []) {
    const grandFinal = scheduled.find((entry) => entry.matchId === reset.afterMatchId)
    if (!grandFinal) continue

    const earliest = Math.max(startFloor, grandFinal.endsAt.getTime() + rest)
    const slot = scheduleInterval(input, earliest, duration, [], booked)
    if (!slot) continue

    booked.push(book(slot.courtId, slot.startsAt, duration, []))
    scheduled.push({
      matchId: reset.id,
      courtId: slot.courtId,
      startsAt: new Date(slot.startsAt),
      endsAt: new Date(slot.endsAt),
      afterEndWarning: slot.endsAt > endLimit,
      conditional: true,
    })
  }

  return scheduled
}
