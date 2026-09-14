import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { categories, courts, matchSlots, matches, teamMembers, tournaments, type Match, type Tournament } from '@/lib/db/schema'
import {
  scheduleReadyMatches,
  type ConditionalReset,
  type CourtReservation,
  type ParticipantReservation,
  type SchedulingMatch,
} from '@/lib/domain/scheduling'

const MINUTE = 60_000
type MatchState = Match['state']
const OPEN_STATES: readonly MatchState[] = ['pending', 'scheduled']
const FIXED_STATES: readonly MatchState[] = ['in_progress', 'completed', 'forfeit']

export interface ManualScheduleInput {
  matchId: string
  courtId: string
  startsAt: Date
  endsAt: Date
  tournamentId: string
}

function zoneOffset(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute')) - instant.getTime()
}

function tournamentInstant(tournament: Tournament, time: string): Date {
  const [year, month, day] = tournament.date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const guess = wall - zoneOffset(new Date(wall), tournament.timezone)
  return new Date(wall - zoneOffset(new Date(guess), tournament.timezone))
}

async function loadTournamentGraph(tournamentId: string) {
  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1)
  if (!tournament) throw new Error('Torneo no encontrado')
  const tournamentCourts = await db.select().from(courts).where(eq(courts.tournamentId, tournamentId)).orderBy(asc(courts.position))
  const categoryRows = await db.select({ id: categories.id }).from(categories).where(eq(categories.tournamentId, tournamentId))
  const categoryIds = categoryRows.map((row) => row.id)
  const matchRows = categoryIds.length ? await db.select().from(matches).where(inArray(matches.categoryId, categoryIds)) : []
  const matchIds = matchRows.map((row) => row.id)
  const slotRows = matchIds.length
    ? await db.select({ matchId: matchSlots.matchId, teamId: matchSlots.teamId, sourceMatchId: matchSlots.sourceMatchId }).from(matchSlots).where(inArray(matchSlots.matchId, matchIds))
    : []
  const memberRows = categoryIds.length
    ? await db.select({ teamId: teamMembers.teamId, participantId: teamMembers.participantId }).from(teamMembers).where(inArray(teamMembers.categoryId, categoryIds))
    : []
  return { tournament, tournamentCourts, matchRows, slotRows, memberRows }
}

type SlotRow = { matchId: string; teamId: string | null; sourceMatchId: string | null }
type MemberRow = { teamId: string; participantId: string }

function indexSlots(slotRows: readonly SlotRow[], memberRows: readonly MemberRow[]) {
  const members = new Map<string, string[]>()
  for (const member of memberRows) members.set(member.teamId, [...(members.get(member.teamId) ?? []), member.participantId])
  const teams = new Map<string, string[]>()
  for (const slot of slotRows) if (slot.teamId) teams.set(slot.matchId, [...(teams.get(slot.matchId) ?? []), slot.teamId])
  const participants = new Map<string, string[]>()
  for (const [matchId, teamIds] of teams) participants.set(matchId, teamIds.flatMap((teamId) => members.get(teamId) ?? []))
  return { teams, participants }
}

function fixedInterval(match: Match, shortMinutes: number, longMinutes: number): { startsAt: Date; endsAt: Date } | null {
  const startsAt = match.actualStartAt ?? match.scheduledStartAt
  if (!startsAt) return null
  const endsAt = match.actualEndAt ?? match.scheduledEndAt
  if (endsAt && endsAt.getTime() > startsAt.getTime()) return { startsAt, endsAt }
  const minutes = match.format === 'best-of-three' ? longMinutes : shortMinutes
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * MINUTE) }
}

export async function replanPendingMatches(tournamentId: string, from: Date): Promise<void> {
  const { tournament, tournamentCourts, matchRows, slotRows, memberRows } = await loadTournamentGraph(tournamentId)
  const { teams, participants } = indexSlots(slotRows, memberRows)

  const dependentCounts = new Map<string, number>()
  for (const slot of slotRows) if (slot.sourceMatchId) dependentCounts.set(slot.sourceMatchId, (dependentCounts.get(slot.sourceMatchId) ?? 0) + 1)
  const conditionalResets: ConditionalReset[] = matchRows
    .filter((match) => match.state === 'cancelled' && match.resultReason === 'conditional-reset')
    .flatMap((match) => {
      const grandFinal = matchRows.find((row) => row.categoryId === match.categoryId && row.stage === 'grand-final')
      return grandFinal ? [{ id: match.id, afterMatchId: grandFinal.id }] : []
    })

  const ready: SchedulingMatch[] = matchRows
    .filter((match) => OPEN_STATES.includes(match.state) && (teams.get(match.id) ?? []).length === 2)
    .map((match) => ({
      id: match.id,
      format: match.format,
      participantIds: participants.get(match.id) ?? [],
      readyAt: from,
      dependentCount: dependentCounts.get(match.id) ?? 0,
    }))

  const courtReservations: CourtReservation[] = []
  const participantReservations: ParticipantReservation[] = []
  for (const match of matchRows.filter((row) => FIXED_STATES.includes(row.state))) {
    const interval = fixedInterval(match, tournament.shortMatchMinutes, tournament.longMatchMinutes)
    if (!interval) continue
    if (match.courtId) courtReservations.push({ courtId: match.courtId, ...interval })
    for (const participantId of participants.get(match.id) ?? []) participantReservations.push({ participantId, ...interval })
  }

  const schedule = scheduleReadyMatches({
    matches: ready,
    courts: tournamentCourts.map((court) => ({ id: court.id, enabled: court.enabled })),
    tournamentStartsAt: tournamentInstant(tournament, tournament.startsAt),
    tournamentEndsAt: tournamentInstant(tournament, tournament.endsAt),
    shortMatchMinutes: tournament.shortMatchMinutes,
    longMatchMinutes: tournament.longMatchMinutes,
    restMinutes: tournament.restMinutes,
    courtReservations,
    participantReservations,
    conditionalResets,
  })

  await db.transaction(async (tx) => {
    for (const entry of schedule) {
      const slot = { courtId: entry.courtId, scheduledStartAt: entry.startsAt, scheduledEndAt: entry.endsAt }
      const target = entry.conditional
        ? and(eq(matches.id, entry.matchId), eq(matches.state, 'cancelled'), eq(matches.resultReason, 'conditional-reset'))
        : and(eq(matches.id, entry.matchId), inArray(matches.state, OPEN_STATES))
      await tx.update(matches).set(slot).where(target)
    }
  })
}

export async function assertManualSchedule(input: ManualScheduleInput): Promise<void> {
  const { tournament, matchRows, slotRows, memberRows } = await loadTournamentGraph(input.tournamentId)
  const { participants } = indexSlots(slotRows, memberRows)
  const proposed = new Set(participants.get(input.matchId) ?? [])
  const startsAt = input.startsAt.getTime()
  const endsAt = input.endsAt.getTime()
  const rest = tournament.restMinutes * MINUTE

  for (const match of matchRows) {
    if (match.id === input.matchId || !match.scheduledStartAt || !match.scheduledEndAt) continue
    const otherStart = match.scheduledStartAt.getTime()
    const otherEnd = match.scheduledEndAt.getTime()
    const overlaps = startsAt < otherEnd && otherStart < endsAt
    if (match.courtId === input.courtId && overlaps) throw new Error('La cancha ya esta ocupada en ese horario')
    if (!(participants.get(match.id) ?? []).some((participantId) => proposed.has(participantId))) continue
    if (overlaps) throw new Error('Un participante ya tiene un partido en ese horario')
    if (startsAt < otherEnd + rest && otherStart - rest < endsAt) throw new Error('No se respeta el descanso minimo')
  }
}
