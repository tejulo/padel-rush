import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import {
  categories,
  courts,
  matchSlots,
  matches,
  participants,
  registrations,
  teamMembers,
  teams,
  tournaments,
  type Match,
  type Tournament,
} from '@/lib/db/schema'
import { validateScore, type ScoreSet } from '@/lib/domain/scoring'
import type { MatchSlot } from '@/lib/domain/types'
import { lockTournamentForWrite, type TournamentTransaction } from '@/lib/services/tournaments'
import { assertManualSchedule, replanPendingMatches, tournamentInstant } from '@/lib/services/scheduling'

export interface RecordResultInput {
  matchId: string
  version: number
  sets: readonly ScoreSet[]
}

export interface ForfeitInput {
  matchId: string
  version: number
  reason: 'absence' | 'retirement'
  forfeitTeamId: string
}

export interface SubstitutePlayerInput {
  teamId: string
  outgoingParticipantId: string
  replacementParticipantId: string
  version?: number
}

export type MatchContext = {
  match: Match
  category: typeof categories.$inferSelect
  tournament: Tournament
}

export type TeamContext = {
  team: typeof teams.$inferSelect
  category: typeof categories.$inferSelect
  tournament: Tournament
}

type MatchDatabase = TournamentTransaction
type SlotRow = typeof matchSlots.$inferSelect
type CategoryRow = typeof categories.$inferSelect

function staleVersion(version: number, current: number): void {
  if (!Number.isInteger(version) || version !== current) throw new Error('Datos desactualizados')
}

async function lockedMatchContext(tx: MatchDatabase, matchId: string): Promise<MatchContext> {
  const [reference] = await tx
    .select({ tournamentId: categories.tournamentId })
    .from(matches)
    .innerJoin(categories, eq(matches.categoryId, categories.id))
    .where(eq(matches.id, matchId))
    .limit(1)
  if (!reference) throw new Error('Partido no encontrado')

  const { tournament, tournamentCategories } = await lockTournamentForWrite(tx, reference.tournamentId)
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId)).for('update').limit(1)
  if (!match) throw new Error('Partido no encontrado')
  const category = tournamentCategories.find((row) => row.id === match.categoryId)
  if (!category) throw new Error('Categoria no encontrada')
  return { match, category, tournament }
}

export type MatchBoardTeam = {
  id: string
  name: string
  version: number
  eligibleForSubstitution: boolean
  members: { id: string; name: string }[]
}

export type MatchBoardEntry = {
  match: Match
  category: typeof categories.$inferSelect
  courtName: string | null
  homeTeam: MatchBoardTeam | null
  awayTeam: MatchBoardTeam | null
  scheduledStartLabel: string | null
  afterEndWarning: boolean
  replacementCandidates: { id: string; name: string }[]
}

const STARTED_MATCH_STATES: readonly Match['state'][] = ['in_progress', 'completed', 'forfeit']

export async function listTournamentMatches(tournamentId: string): Promise<MatchBoardEntry[]> {
  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1)
  const categoryRows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId))
  const categoryIds = categoryRows.map((category) => category.id)
  const [rows, memberRows, registeredRows] = await Promise.all([
    db
      .select({
        match: matches,
        category: categories,
        courtName: courts.name,
        slot: matchSlots.slot,
        teamId: teams.id,
        teamName: teams.name,
        teamVersion: teams.version,
        teamLocked: teams.locked,
        teamSubstitutionUsed: teams.substitutionUsed,
      })
      .from(matches)
      .innerJoin(categories, eq(matches.categoryId, categories.id))
      .leftJoin(courts, eq(matches.courtId, courts.id))
      .leftJoin(matchSlots, eq(matchSlots.matchId, matches.id))
      .leftJoin(teams, eq(matchSlots.teamId, teams.id))
      .where(eq(categories.tournamentId, tournamentId))
      .orderBy(asc(categories.category), asc(matches.round), asc(matches.position), asc(matchSlots.slot)),
    categoryIds.length
      ? db
          .select({ teamId: teamMembers.teamId, participantId: participants.id, name: participants.name })
          .from(teamMembers)
          .innerJoin(participants, eq(teamMembers.participantId, participants.id))
          .where(inArray(teamMembers.categoryId, categoryIds))
          .orderBy(asc(teamMembers.teamId), asc(participants.name))
      : [],
    categoryIds.length
      ? db
          .select({ categoryId: registrations.categoryId, participantId: participants.id, name: participants.name })
          .from(registrations)
          .innerJoin(participants, eq(registrations.participantId, participants.id))
          .where(inArray(registrations.categoryId, categoryIds))
          .orderBy(asc(participants.name))
      : [],
  ])

  const membersByTeam = new Map<string, { id: string; name: string }[]>()
  for (const member of memberRows) {
    membersByTeam.set(member.teamId, [...(membersByTeam.get(member.teamId) ?? []), { id: member.participantId, name: member.name }])
  }
  const candidatesByCategory = new Map<string, { id: string; name: string }[]>()
  for (const registered of registeredRows) {
    candidatesByCategory.set(registered.categoryId, [
      ...(candidatesByCategory.get(registered.categoryId) ?? []),
      { id: registered.participantId, name: registered.name },
    ])
  }

  const startedTeamIds = new Set(
    rows.filter((row) => row.teamId && STARTED_MATCH_STATES.includes(row.match.state)).map((row) => row.teamId!),
  )
  const endLimit = tournament ? tournamentInstant(tournament, tournament.endsAt) : null

  const board = new Map<string, MatchBoardEntry>()
  for (const row of rows) {
    if (row.match.state === 'cancelled' && row.match.resultReason === 'conditional-reset') continue
    const startLabel = row.match.scheduledStartAt
      ? new Intl.DateTimeFormat('es-AR', {
          timeZone: tournament?.timezone ?? 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(row.match.scheduledStartAt)
      : null
    const entry = board.get(row.match.id) ?? {
      match: row.match,
      category: row.category,
      courtName: row.courtName,
      homeTeam: null,
      awayTeam: null,
      scheduledStartLabel: startLabel,
      afterEndWarning: Boolean(endLimit && row.match.scheduledEndAt && row.match.scheduledEndAt.getTime() > endLimit.getTime()),
      replacementCandidates: candidatesByCategory.get(row.match.categoryId) ?? [],
    }
    const team: MatchBoardTeam | null =
      row.teamId && row.teamName
        ? {
            id: row.teamId,
            name: row.teamName,
            version: row.teamVersion!,
            eligibleForSubstitution:
              tournament?.state === 'in_progress' &&
              entry.category.state === 'in_progress' &&
              Boolean(row.teamLocked) &&
              !row.teamSubstitutionUsed &&
              !startedTeamIds.has(row.teamId),
            members: membersByTeam.get(row.teamId) ?? [],
          }
        : null
    if (row.slot === 'a') entry.homeTeam = team
    if (row.slot === 'b') entry.awayTeam = team
    board.set(row.match.id, entry)
  }
  return [...board.values()]
}

export interface MoveMatchInput {
  matchId: string
  courtId: string
  startsAt: Date
  tournamentId: string
  version: number
}

export async function moveMatch(input: MoveMatchInput): Promise<Match> {
  return db.transaction(async (tx) => {
    const [reference] = await tx
      .select({ tournamentId: categories.tournamentId })
      .from(matches)
      .innerJoin(categories, eq(matches.categoryId, categories.id))
      .where(eq(matches.id, input.matchId))
      .limit(1)
    if (!reference || reference.tournamentId !== input.tournamentId) throw new Error('Partido no encontrado')

    const { tournament } = await lockTournamentForWrite(tx, input.tournamentId)
    if (tournament.state !== 'in_progress') throw new Error('El torneo no admite cambios de horario')
    const [match] = await tx.select().from(matches).where(eq(matches.id, input.matchId)).for('update').limit(1)
    if (!match) throw new Error('Partido no encontrado')
    if (match.state !== 'pending' && match.state !== 'scheduled') {
      throw new Error('Solo se pueden mover partidos pendientes')
    }
    staleVersion(input.version, match.version)

    const [court] = await tx
      .select()
      .from(courts)
      .where(and(eq(courts.id, input.courtId), eq(courts.tournamentId, input.tournamentId)))
      .limit(1)
    if (!court?.enabled) throw new Error('La cancha no esta habilitada')

    const minutes = match.format === 'best-of-three' ? tournament.longMatchMinutes : tournament.shortMatchMinutes
    const endsAt = new Date(input.startsAt.getTime() + minutes * 60_000)
    const startLimit = tournamentInstant(tournament, tournament.startsAt)
    const endLimit = tournamentInstant(tournament, tournament.endsAt)
    if (input.startsAt.getTime() < startLimit.getTime()) throw new Error('El partido no puede empezar antes del torneo')
    if (endsAt.getTime() > endLimit.getTime()) throw new Error('El partido no puede terminar despues de la hora limite')

    await assertManualSchedule({ ...input, endsAt }, tx)

    const [updated] = await tx
      .update(matches)
      .set({
        courtId: input.courtId,
        scheduledStartAt: input.startsAt,
        scheduledEndAt: endsAt,
        state: 'scheduled',
        version: sql<number>`${matches.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(matches.id, input.matchId), eq(matches.version, input.version), inArray(matches.state, ['pending', 'scheduled'])))
      .returning()
    if (!updated) throw new Error('Datos desactualizados')
    return updated
  })
}

export async function getMatchContext(matchId: string): Promise<MatchContext | null> {
  const [row] = await db
    .select({ match: matches, category: categories, tournament: tournaments })
    .from(matches)
    .innerJoin(categories, eq(matches.categoryId, categories.id))
    .innerJoin(tournaments, eq(categories.tournamentId, tournaments.id))
    .where(eq(matches.id, matchId))
    .limit(1)
  return row ?? null
}

export async function getTeamContext(teamId: string): Promise<TeamContext | null> {
  const [row] = await db
    .select({ team: teams, category: categories, tournament: tournaments })
    .from(teams)
    .innerJoin(categories, eq(teams.categoryId, categories.id))
    .innerJoin(tournaments, eq(categories.tournamentId, tournaments.id))
    .where(eq(teams.id, teamId))
    .limit(1)
  return row ?? null
}

async function lockedSlots(tx: MatchDatabase, matchId: string): Promise<SlotRow[]> {
  return tx.select().from(matchSlots).where(eq(matchSlots.matchId, matchId)).orderBy(asc(matchSlots.slot)).for('update')
}

function requireTwoTeams(slots: readonly SlotRow[]): [SlotRow, SlotRow] {
  const home = slots.find((slot) => slot.slot === 'a')
  const away = slots.find((slot) => slot.slot === 'b')
  if (!home?.teamId || !away?.teamId) throw new Error('El partido no tiene dos equipos')
  if (home.teamId === away.teamId) throw new Error('Un partido requiere dos equipos distintos')
  return [home, away]
}

function assertPlayable(match: Match): void {
  if (match.state === 'pending') throw new Error('El partido no esta programado')
  if (match.state === 'cancelled') {
    throw new Error(
      match.resultReason === 'conditional-reset'
        ? 'El reinicio de la gran final todavia no esta disponible'
        : 'El partido esta cancelado',
    )
  }
  if (match.state !== 'scheduled' && match.state !== 'in_progress') throw new Error('El partido ya tiene resultado')
}

function assertActiveTournament(context: MatchContext): void {
  if (context.tournament.state !== 'in_progress' || context.category.state !== 'in_progress') {
    throw new Error('El torneo no admite resultados')
  }
}

function winnerAndLoser(
  slots: readonly SlotRow[],
  winner: 'home' | 'away',
): { winnerTeamId: string; loserTeamId: string; winningSlot: MatchSlot } {
  const [home, away] = requireTwoTeams(slots)
  return winner === 'home'
    ? { winnerTeamId: home.teamId!, loserTeamId: away.teamId!, winningSlot: 'a' }
    : { winnerTeamId: away.teamId!, loserTeamId: home.teamId!, winningSlot: 'b' }
}

async function routeResult(
  tx: MatchDatabase,
  sourceMatchId: string,
  winnerTeamId: string,
  loserTeamId: string,
): Promise<void> {
  const routes = await tx
    .select()
    .from(matchSlots)
    .where(eq(matchSlots.sourceMatchId, sourceMatchId))
    .orderBy(asc(matchSlots.matchId), asc(matchSlots.slot))
    .for('update')

  for (const route of routes) {
    const teamId = route.sourceOutcome === 'winner' ? winnerTeamId : loserTeamId
    const [destination] = await tx.select().from(matches).where(eq(matches.id, route.matchId)).for('update').limit(1)
    if (!destination) throw new Error('Ruta de cuadro invalida')
    if (destination.state === 'completed' || destination.state === 'forfeit' || destination.state === 'in_progress') {
      throw new Error('No se puede avanzar: hay un partido posterior iniciado')
    }

    const [destinationSlot] = await tx.select().from(matchSlots).where(eq(matchSlots.id, route.id)).for('update').limit(1)
    if (!destinationSlot) throw new Error('Ruta de cuadro invalida')
    if (destinationSlot.teamId && destinationSlot.teamId !== teamId) throw new Error('La ruta de cuadro ya esta ocupada')
    await tx.update(matchSlots).set({ teamId }).where(eq(matchSlots.id, route.id))
  }
}

async function activateConditionalReset(
  tx: MatchDatabase,
  sourceMatchId: string,
  winningSlot: MatchSlot,
): Promise<void> {
  if (winningSlot !== 'b') return

  const candidates = await tx
    .select({ resetId: matches.id })
    .from(matchSlots)
    .innerJoin(matches, eq(matchSlots.matchId, matches.id))
    .where(
      and(
        eq(matchSlots.sourceMatchId, sourceMatchId),
        eq(matchSlots.sourceOutcome, 'winner'),
        eq(matches.stage, 'grand-final-reset'),
        eq(matches.state, 'cancelled'),
        eq(matches.resultReason, 'conditional-reset'),
      ),
    )
    .for('update')

  const resetIds = [...new Set(candidates.map(({ resetId }) => resetId))]
  for (const resetId of resetIds) {
    await tx
      .update(matches)
      .set({ state: 'pending', resultReason: null, version: sql<number>`${matches.version} + 1`, updatedAt: new Date() })
      .where(and(eq(matches.id, resetId), eq(matches.state, 'cancelled'), eq(matches.resultReason, 'conditional-reset')))
  }
}

async function finishMatch(
  tx: MatchDatabase,
  context: MatchContext,
  winnerTeamId: string,
  loserTeamId: string,
  winningSlot: MatchSlot,
  score: readonly ScoreSet[],
  resultReason: string | null,
): Promise<Match> {
  const now = new Date()
  const [updated] = await tx
    .update(matches)
    .set({
      state: resultReason ? 'forfeit' : 'completed',
      score: [...score],
      resultReason,
      winnerTeamId,
      loserTeamId,
      actualStartAt: context.match.actualStartAt ?? now,
      actualEndAt: now,
      version: sql<number>`${matches.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(matches.id, context.match.id), eq(matches.version, context.match.version)))
    .returning()
  if (!updated) throw new Error('Datos desactualizados')

  await routeResult(tx, context.match.id, winnerTeamId, loserTeamId)
  await activateConditionalReset(tx, context.match.id, winningSlot)
  await updateCompletion(tx, context)
  return updated
}

function categoryFinished(categoryMatches: readonly Match[]): boolean {
  const reset = categoryMatches.find((match) => match.stage === 'grand-final-reset')
  const grandFinal = categoryMatches.find((match) => match.stage === 'grand-final')
  if (!grandFinal || (grandFinal.state !== 'completed' && grandFinal.state !== 'forfeit')) return false
  if (!reset) return true
  const resetTerminal =
    reset.state === 'completed' || reset.state === 'forfeit' || (reset.state === 'cancelled' && reset.resultReason === 'conditional-reset')
  if (!resetTerminal) return false
  return categoryMatches.every(
    (match) =>
      match.id === reset.id ||
      match.state === 'completed' ||
      match.state === 'forfeit' ||
      (match.state === 'cancelled' && match.resultReason === 'conditional-reset'),
  )
}

async function updateCompletion(tx: MatchDatabase, context: MatchContext): Promise<void> {
  const categoryMatches = await tx.select().from(matches).where(eq(matches.categoryId, context.category.id))
  if (!categoryFinished(categoryMatches)) return

  if (context.category.state !== 'finished') {
    await tx
      .update(categories)
      .set({ state: 'finished', version: sql<number>`${categories.version} + 1`, updatedAt: new Date() })
      .where(and(eq(categories.id, context.category.id), eq(categories.state, 'in_progress')))
  }

  const allCategories = await tx.select().from(categories).where(eq(categories.tournamentId, context.tournament.id))
  if (allCategories.every((category) => category.state === 'finished' || category.state === 'cancelled')) {
    await tx
      .update(tournaments)
      .set({ state: 'finished', version: sql<number>`${tournaments.version} + 1`, updatedAt: new Date() })
      .where(and(eq(tournaments.id, context.tournament.id), eq(tournaments.state, 'in_progress')))
  }
}

export async function startMatch(matchId: string, version: number): Promise<Match> {
  return db.transaction(async (tx) => {
    const context = await lockedMatchContext(tx, matchId)
    assertActiveTournament(context)
    if (context.match.state !== 'scheduled') throw new Error('Solo se puede iniciar un partido programado')
    staleVersion(version, context.match.version)
    requireTwoTeams(await lockedSlots(tx, matchId))
    const now = new Date()
    const [updated] = await tx
      .update(matches)
      .set({ state: 'in_progress', actualStartAt: now, version: sql<number>`${matches.version} + 1`, updatedAt: now })
      .where(and(eq(matches.id, matchId), eq(matches.version, context.match.version), eq(matches.state, 'scheduled')))
      .returning()
    if (!updated) throw new Error('Datos desactualizados')
    return updated
  })
}

export async function recordResult(input: RecordResultInput): Promise<Match> {
  return db.transaction(async (tx) => {
    const context = await lockedMatchContext(tx, input.matchId)
    assertActiveTournament(context)
    assertPlayable(context.match)
    staleVersion(input.version, context.match.version)
    const validation = validateScore(context.match.format, input.sets)
    if (!validation.ok) throw new Error(validation.message)
    const slots = await lockedSlots(tx, input.matchId)
    const { winnerTeamId, loserTeamId, winningSlot } = winnerAndLoser(slots, validation.winner)
    const result = await finishMatch(tx, context, winnerTeamId, loserTeamId, winningSlot, input.sets, null)
    await replanPendingMatches(context.tournament.id, new Date(), tx)
    return result
  })
}

function forfeitScore(format: Match['format'], homeTeamId: string, loserTeamId: string): ScoreSet[] {
  const winnerSlot = loserTeamId === homeTeamId ? 'away' : 'home'
  const sets = format === 'one-set-nine' ? [9] : [6, 6]
  return sets.map((games) => (winnerSlot === 'home' ? { home: games, away: 0 } : { home: 0, away: games }))
}

export async function recordForfeit(input: ForfeitInput): Promise<Match> {
  return db.transaction(async (tx) => {
    const context = await lockedMatchContext(tx, input.matchId)
    assertActiveTournament(context)
    assertPlayable(context.match)
    staleVersion(input.version, context.match.version)
    if (input.reason !== 'absence' && input.reason !== 'retirement') throw new Error('Motivo de derrota automatica invalido')
    const slots = await lockedSlots(tx, input.matchId)
    const [home, away] = requireTwoTeams(slots)
    if (input.forfeitTeamId !== home.teamId && input.forfeitTeamId !== away.teamId) {
      throw new Error('El equipo que pierde no pertenece al partido')
    }
    const winnerTeamId = input.forfeitTeamId === home.teamId ? away.teamId! : home.teamId!
    const result = await finishMatch(
      tx,
      context,
      winnerTeamId,
      input.forfeitTeamId,
      input.forfeitTeamId === home.teamId ? 'b' : 'a',
      forfeitScore(context.match.format, home.teamId!, input.forfeitTeamId),
      input.reason,
    )
    await replanPendingMatches(context.tournament.id, new Date(), tx)
    return result
  })
}

async function dependentMatchIds(tx: MatchDatabase, categoryId: string, sourceMatchId: string): Promise<Set<string>> {
  const categoryMatches = await tx.select().from(matches).where(eq(matches.categoryId, categoryId))
  const categoryMatchIds = new Set(categoryMatches.map((match) => match.id))
  const routes = await tx
    .select({ matchId: matchSlots.matchId, sourceMatchId: matchSlots.sourceMatchId })
    .from(matchSlots)
    .where(inArray(matchSlots.matchId, [...categoryMatchIds]))
  const nextBySource = new Map<string, string[]>()
  for (const route of routes) {
    if (!route.sourceMatchId) continue
    const destinations = nextBySource.get(route.sourceMatchId) ?? []
    destinations.push(route.matchId)
    nextBySource.set(route.sourceMatchId, destinations)
  }

  const dependent = new Set<string>()
  const pending = [...(nextBySource.get(sourceMatchId) ?? [])]
  while (pending.length > 0) {
    const matchId = pending.shift()!
    if (dependent.has(matchId)) continue
    dependent.add(matchId)
    pending.push(...(nextBySource.get(matchId) ?? []))
  }
  return dependent
}

async function clearDownstreamRoutes(tx: MatchDatabase, categoryId: string, sourceMatchId: string): Promise<void> {
  const dependent = await dependentMatchIds(tx, categoryId, sourceMatchId)
  if (dependent.size === 0) return
  const dependentRows = await tx.select().from(matches).where(inArray(matches.id, [...dependent])).for('update')
  if (dependentRows.some((match) => match.state === 'completed' || match.state === 'forfeit')) {
    throw new Error('No se pueden corregir resultados: hay partidos posteriores finalizados')
  }
  if (dependentRows.some((match) => match.state === 'in_progress')) {
    throw new Error('No se pueden corregir resultados: hay partidos posteriores iniciados')
  }

  const routes = await tx
    .select()
    .from(matchSlots)
    .where(inArray(matchSlots.matchId, [...dependent]))
    .for('update')
  for (const route of routes) {
    if (!route.sourceMatchId || route.sourceMatchId === sourceMatchId || dependent.has(route.sourceMatchId)) {
      await tx.update(matchSlots).set({ teamId: null }).where(eq(matchSlots.id, route.id))
    }
  }
  for (const match of dependentRows) {
    if (match.stage === 'grand-final-reset') {
      await tx
        .update(matches)
        .set({
          state: 'cancelled',
          resultReason: 'conditional-reset',
          courtId: null,
          scheduledStartAt: null,
          scheduledEndAt: null,
          actualStartAt: null,
          version: sql<number>`${matches.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(matches.id, match.id))
      continue
    }
    await tx
      .update(matches)
      .set({
        state: 'pending',
        courtId: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        actualStartAt: null,
        version: sql<number>`${matches.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(matches.id, match.id))
  }
}

export async function clearResult(matchId: string, version: number): Promise<void> {
  await db.transaction(async (tx) => {
    const context = await lockedMatchContext(tx, matchId)
    if (context.match.state !== 'completed' && context.match.state !== 'forfeit') {
      throw new Error('El partido no tiene un resultado para corregir')
    }
    staleVersion(version, context.match.version)
    await clearDownstreamRoutes(tx, context.category.id, matchId)

    const state = context.match.scheduledStartAt ? 'scheduled' : 'pending'
    const [updated] = await tx
      .update(matches)
      .set({
        state,
        score: null,
        resultReason: null,
        winnerTeamId: null,
        loserTeamId: null,
        actualStartAt: null,
        actualEndAt: null,
        version: sql<number>`${matches.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(matches.id, matchId), eq(matches.version, context.match.version)))
      .returning({ id: matches.id })
    if (!updated) throw new Error('Datos desactualizados')

    if (context.category.state === 'finished') {
      await tx
        .update(categories)
        .set({ state: 'in_progress', version: sql<number>`${categories.version} + 1`, updatedAt: new Date() })
        .where(and(eq(categories.id, context.category.id), eq(categories.state, 'finished')))
      await tx
        .update(tournaments)
        .set({ state: 'in_progress', version: sql<number>`${tournaments.version} + 1`, updatedAt: new Date() })
        .where(and(eq(tournaments.id, context.tournament.id), eq(tournaments.state, 'finished')))
    }
    await replanPendingMatches(context.tournament.id, new Date(), tx)
  })
}

function assertSubstitutionGender(category: CategoryRow['category'], members: readonly { gender: string }[]): void {
  const genders = members.map((member) => member.gender)
  if (category === 'men' && genders.some((gender) => gender !== 'man')) throw new Error('La sustitucion no es compatible con la categoria')
  if (category === 'women' && genders.some((gender) => gender !== 'woman')) throw new Error('La sustitucion no es compatible con la categoria')
  if (category === 'mixed' && !(genders.includes('man') && genders.includes('woman'))) {
    throw new Error('La sustitucion no es compatible con la categoria')
  }
}

export async function substitutePlayer(input: SubstitutePlayerInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [reference] = await tx
      .select({ tournamentId: categories.tournamentId })
      .from(teams)
      .innerJoin(categories, eq(teams.categoryId, categories.id))
      .where(eq(teams.id, input.teamId))
      .limit(1)
    if (!reference) throw new Error('Equipo no encontrado')
    const { tournament, tournamentCategories } = await lockTournamentForWrite(tx, reference.tournamentId)
    const [team] = await tx.select().from(teams).where(eq(teams.id, input.teamId)).for('update').limit(1)
    if (!team) throw new Error('Equipo no encontrado')
    const category = tournamentCategories.find((row) => row.id === team.categoryId)
    if (!category) throw new Error('Categoria no encontrada')
    if (!team.locked || category.state !== 'in_progress' || tournament.state !== 'in_progress') {
      throw new Error('El equipo no admite sustituciones')
    }
    if (team.substitutionUsed) throw new Error('Cada equipo solo permite una sustitucion')
    if (input.version !== undefined) staleVersion(input.version, team.version)

    const started = await tx
      .select({ id: matches.id })
      .from(matchSlots)
      .innerJoin(matches, eq(matchSlots.matchId, matches.id))
      .where(and(eq(matchSlots.teamId, team.id), inArray(matches.state, ['in_progress', 'completed', 'forfeit'])))
      .limit(1)
    if (started.length > 0) throw new Error('El equipo ya comenzo un partido')

    const memberRows = await tx
      .select({ member: teamMembers, participant: participants })
      .from(teamMembers)
      .innerJoin(participants, eq(teamMembers.participantId, participants.id))
      .where(eq(teamMembers.teamId, team.id))
      .for('update')
    const outgoing = memberRows.find((row) => row.member.participantId === input.outgoingParticipantId)
    if (!outgoing || memberRows.length !== 2) throw new Error('El participante no integra el equipo')
    if (memberRows.some((row) => row.member.participantId === input.replacementParticipantId)) {
      throw new Error('El participante ya integra el equipo')
    }

    const [replacement] = await tx
      .select()
      .from(participants)
      .innerJoin(registrations, eq(registrations.participantId, participants.id))
      .where(and(eq(participants.id, input.replacementParticipantId), eq(participants.tournamentId, tournament.id), eq(registrations.categoryId, category.id)))
      .limit(1)
    if (!replacement) throw new Error('El reemplazo no esta inscripto en la categoria')

    const alreadyAssigned = await tx
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.categoryId, category.id), eq(teamMembers.participantId, input.replacementParticipantId)))
      .limit(1)
    if (alreadyAssigned.length > 0) throw new Error('El reemplazo ya integra otra pareja de la categoria')

    const resultingMembers = memberRows.map((row) =>
      row.member.participantId === input.outgoingParticipantId ? { gender: replacement.participants.gender } : row.participant,
    )
    assertSubstitutionGender(category.category, resultingMembers)

    await tx
      .update(teamMembers)
      .set({ participantId: input.replacementParticipantId })
      .where(eq(teamMembers.id, outgoing.member.id))
    const [updated] = await tx
      .update(teams)
      .set({ substitutionUsed: true, version: sql<number>`${teams.version} + 1`, updatedAt: new Date() })
      .where(and(eq(teams.id, team.id), eq(teams.version, team.version)))
      .returning({ id: teams.id })
    if (!updated) throw new Error('Datos desactualizados')
  })
}
