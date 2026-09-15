import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { categories, courts, matchSlots, matches, participants, teamMembers, teams, tournaments } from '@/lib/db/schema'

export interface PublicTeam {
  id: string
  name: string
  members: string[]
}

export interface PublicMatch {
  id: string
  stage: string
  round: number
  position: number
  state: string
  format: string
  courtName: string | null
  startLabel: string | null
  homeTeam: string | null
  awayTeam: string | null
  score: string | null
  resultReason: 'absence' | 'retirement' | 'conditional-reset' | null
}

export interface PublicCategory {
  id: string
  name: 'men' | 'women' | 'mixed'
  state: string
  teams: PublicTeam[]
  matches: PublicMatch[]
}

export interface PublicTournament {
  name: string
  state: string
  categories: PublicCategory[]
}

function scoreLabel(score: unknown): string | null {
  if (!Array.isArray(score)) return null
  return score.map((set) => `${(set as { home: number }).home}-${(set as { away: number }).away}`).join(', ')
}

function startLabel(date: Date | null, timeZone: string): string | null {
  if (!date) return null
  return new Intl.DateTimeFormat('es-AR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function publicReason(reason: string | null): PublicMatch['resultReason'] {
  return reason === 'absence' || reason === 'retirement' || reason === 'conditional-reset' ? reason : null
}

export async function getPublicTournament(token: string): Promise<PublicTournament | null> {
  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.publicToken, token)).limit(1)
  if (!tournament) return null

  const categoryRows = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournament.id))
    .orderBy(asc(categories.category))
  const categoryIds = categoryRows.map((category) => category.id)

  const teamRows = categoryIds.length
    ? await db
        .select()
        .from(teams)
        .where(inArray(teams.categoryId, categoryIds))
        .orderBy(asc(teams.name))
    : []
  const teamIds = teamRows.map((team) => team.id)
  const memberRows = teamIds.length
    ? await db
        .select({ teamId: teamMembers.teamId, name: participants.name })
        .from(teamMembers)
        .innerJoin(participants, eq(teamMembers.participantId, participants.id))
        .where(inArray(teamMembers.teamId, teamIds))
        .orderBy(asc(teamMembers.id))
    : []
  const matchRows = categoryIds.length
    ? await db
        .select({ match: matches, courtName: courts.name })
        .from(matches)
        .leftJoin(courts, eq(matches.courtId, courts.id))
        .where(inArray(matches.categoryId, categoryIds))
        .orderBy(asc(matches.round), asc(matches.position))
    : []
  const matchIds = matchRows.map((row) => row.match.id)
  const slotRows = matchIds.length
    ? await db
        .select({ matchId: matchSlots.matchId, slot: matchSlots.slot, teamId: matchSlots.teamId })
        .from(matchSlots)
        .where(inArray(matchSlots.matchId, matchIds))
    : []

  const teamNameById = new Map(teamRows.map((team) => [team.id, team.name]))
  const teamMembersById = new Map<string, string[]>()
  for (const member of memberRows) {
    teamMembersById.set(member.teamId, [...(teamMembersById.get(member.teamId) ?? []), member.name])
  }

  const publicTeams = teamRows.map((team) => ({
    id: team.id,
    name: team.name,
    members: teamMembersById.get(team.id) ?? [],
  }))
  const teamsByCategory = new Map<string, PublicTeam[]>()
  for (const team of publicTeams) {
    const categoryId = teamRows.find((row) => row.id === team.id)!.categoryId
    teamsByCategory.set(categoryId, [...(teamsByCategory.get(categoryId) ?? []), team])
  }

  const slotsByMatch = new Map<string, { slot: string; teamId: string | null }[]>()
  for (const slot of slotRows) {
    slotsByMatch.set(slot.matchId, [...(slotsByMatch.get(slot.matchId) ?? []), slot])
  }

  const matchesByCategory = new Map<string, PublicMatch[]>()
  for (const row of matchRows) {
    const slots = slotsByMatch.get(row.match.id) ?? []
    const homeTeam = slots.find((slot) => slot.slot === 'a')?.teamId
    const awayTeam = slots.find((slot) => slot.slot === 'b')?.teamId
    const entry: PublicMatch = {
      id: row.match.id,
      stage: row.match.stage,
      round: row.match.round,
      position: row.match.position,
      state: row.match.state,
      format: row.match.format,
      courtName: row.courtName,
      startLabel: startLabel(row.match.scheduledStartAt, tournament.timezone),
      homeTeam: homeTeam ? (teamNameById.get(homeTeam) ?? null) : null,
      awayTeam: awayTeam ? (teamNameById.get(awayTeam) ?? null) : null,
      score: scoreLabel(row.match.score),
      resultReason: publicReason(row.match.resultReason),
    }
    matchesByCategory.set(row.match.categoryId, [...(matchesByCategory.get(row.match.categoryId) ?? []), entry])
  }

  return {
    name: tournament.name,
    state: tournament.state,
    categories: categoryRows.map((category) => ({
      id: category.id,
      name: category.category,
      state: category.state,
      teams: teamsByCategory.get(category.id) ?? [],
      matches: matchesByCategory.get(category.id) ?? [],
    })),
  }
}
