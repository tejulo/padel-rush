import type { MatchFormat, MatchOutcome, MatchSlot, MatchStage, MatchState } from '@/lib/domain/types'

export type { MatchStage } from '@/lib/domain/types'

export interface BuildBracketInput {
  categoryId: string
  teamIds: readonly string[]
}

export interface BracketRoute {
  key: string
  slot: MatchSlot
}

export interface BracketSource {
  key: string
  outcome: MatchOutcome
}

export interface BracketSlot {
  teamId?: string
  source?: BracketSource
}

export interface ResetActivation {
  matchKey: string
  winnerSlot: MatchSlot
}

export interface BracketMatch {
  key: string
  categoryId: string
  stage: MatchStage
  round: number
  position: number
  format: MatchFormat
  state: MatchState
  active: boolean
  slots: Record<MatchSlot, BracketSlot>
  winnerTo?: BracketRoute
  loserTo?: BracketRoute
  activation?: ResetActivation
  winnerTeamId?: string
  loserTeamId?: string
  resultReason?: string
}

export interface BracketResult {
  matchKey: string
  winnerTeamId: string
  loserTeamId: string
}

const FINAL_STAGES: readonly MatchStage[] = [
  'winners-final',
  'losers-final',
  'grand-final',
  'grand-final-reset',
]

export function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && 2 ** Math.floor(Math.log2(value)) === value
}

export function isFinalStage(stage: MatchStage): boolean {
  return FINAL_STAGES.includes(stage)
}

function emptySlots(): Record<MatchSlot, BracketSlot> {
  return { a: {}, b: {} }
}

function matchFormat(stage: MatchStage): MatchFormat {
  return isFinalStage(stage) ? 'best-of-three' : 'one-set-nine'
}

function roundMatch(
  categoryId: string,
  key: string,
  stage: MatchStage,
  round: number,
  position: number,
  active = false,
): BracketMatch {
  return {
    key,
    categoryId,
    stage,
    round,
    position,
    format: matchFormat(stage),
    state: 'pending',
    active,
    slots: emptySlots(),
  }
}

function route(source: BracketMatch, outcome: MatchOutcome, destination: BracketMatch, slot: MatchSlot): void {
  const targetSlot = destination.slots[slot]
  if (targetSlot.teamId || targetSlot.source) throw new Error(`La ruta ${destination.key}:${slot} ya esta ocupada`)

  source[outcome === 'winner' ? 'winnerTo' : 'loserTo'] = { key: destination.key, slot }
  destination.slots[slot] = { source: { key: source.key, outcome } }
}

function findMatch(matches: Map<string, BracketMatch>, key: string): BracketMatch {
  const match = matches.get(key)
  if (!match) throw new Error(`Partido inexistente: ${key}`)
  return match
}

function winnerRouteForLosersRound(round: number, position: number, lastLosersRound: number): BracketRoute {
  if (round === lastLosersRound) return { key: 'GF-1', slot: 'b' }
  if (round % 2 === 1) return { key: `L${round + 1}-${position}`, slot: 'b' }
  return {
    key: `L${round + 1}-${Math.ceil(position / 2)}`,
    slot: position % 2 === 1 ? 'a' : 'b',
  }
}

export function buildBracket(input: BuildBracketInput): BracketMatch[] {
  const { categoryId, teamIds } = input
  if (teamIds.length < 2) throw new Error('La categoria debe tener al menos dos equipos')
  if (!isPowerOfTwo(teamIds.length)) throw new Error('La cantidad de equipos debe ser una potencia de dos')
  if (new Set(teamIds).size !== teamIds.length) throw new Error('No se puede repetir un equipo')

  const roundCount = Math.log2(teamIds.length)
  const matches = new Map<string, BracketMatch>()

  for (let round = 1; round <= roundCount; round += 1) {
    const matchCount = teamIds.length / 2 ** round
    const stage: MatchStage = round === roundCount ? 'winners-final' : 'winners-round'
    for (let position = 1; position <= matchCount; position += 1) {
      const entry = roundMatch(categoryId, `W${round}-${position}`, stage, round, position, round === 1)
      if (round === 1) {
        entry.slots = {
          a: { teamId: teamIds[(position - 1) * 2]! },
          b: { teamId: teamIds[(position - 1) * 2 + 1]! },
        }
      }
      matches.set(entry.key, entry)
    }
  }

  const lastLosersRound = 2 * roundCount - 2
  for (let round = 1; round <= lastLosersRound; round += 1) {
    const matchCount = teamIds.length / 2 ** Math.floor((round + 3) / 2)
    const stage: MatchStage = round === lastLosersRound ? 'losers-final' : 'losers-round'
    for (let position = 1; position <= matchCount; position += 1) {
      const entry = roundMatch(categoryId, `L${round}-${position}`, stage, round, position)
      matches.set(entry.key, entry)
    }
  }

  const grandFinal = roundMatch(categoryId, 'GF-1', 'grand-final', 1, 1)
  const resetFinal = roundMatch(categoryId, 'GF-reset', 'grand-final-reset', 1, 1)
  resetFinal.state = 'cancelled'
  resetFinal.resultReason = 'conditional-reset'
  resetFinal.activation = { matchKey: grandFinal.key, winnerSlot: 'b' }
  matches.set(grandFinal.key, grandFinal)
  matches.set(resetFinal.key, resetFinal)

  for (let round = 1; round <= roundCount; round += 1) {
    const matchCount = teamIds.length / 2 ** round
    for (let position = 1; position <= matchCount; position += 1) {
      const source = findMatch(matches, `W${round}-${position}`)
      if (round < roundCount) {
        route(source, 'winner', findMatch(matches, `W${round + 1}-${Math.ceil(position / 2)}`), position % 2 === 1 ? 'a' : 'b')
      } else {
        route(source, 'winner', grandFinal, 'a')
      }

      if (round === 1 && roundCount > 1) {
        route(source, 'loser', findMatch(matches, `L1-${Math.ceil(position / 2)}`), position % 2 === 1 ? 'a' : 'b')
      } else if (round === 1) {
        route(source, 'loser', grandFinal, 'b')
      } else {
        route(source, 'loser', findMatch(matches, `L${2 * round - 2}-${position}`), 'a')
      }
    }
  }

  for (let round = 1; round <= lastLosersRound; round += 1) {
    const matchCount = teamIds.length / 2 ** Math.floor((round + 3) / 2)
    for (let position = 1; position <= matchCount; position += 1) {
      const source = findMatch(matches, `L${round}-${position}`)
      const destination = winnerRouteForLosersRound(round, position, lastLosersRound)
      route(source, 'winner', findMatch(matches, destination.key), destination.slot)
    }
  }

  route(grandFinal, 'winner', resetFinal, 'a')
  route(grandFinal, 'loser', resetFinal, 'b')

  return [...matches.values()]
}

function cloneMatch(match: BracketMatch): BracketMatch {
  return {
    ...match,
    slots: {
      a: { ...match.slots.a, ...(match.slots.a.source ? { source: { ...match.slots.a.source } } : {}) },
      b: { ...match.slots.b, ...(match.slots.b.source ? { source: { ...match.slots.b.source } } : {}) },
    },
    ...(match.winnerTo ? { winnerTo: { ...match.winnerTo } } : {}),
    ...(match.loserTo ? { loserTo: { ...match.loserTo } } : {}),
    ...(match.activation ? { activation: { ...match.activation } } : {}),
  }
}

function setRoutedTeam(matches: Map<string, BracketMatch>, routeTo: BracketRoute | undefined, teamId: string): void {
  if (!routeTo) return
  const destination = findMatch(matches, routeTo.key)
  destination.slots[routeTo.slot] = {
    ...destination.slots[routeTo.slot],
    teamId,
  }
  if (destination.state === 'pending' && destination.slots.a.teamId && destination.slots.b.teamId) {
    destination.active = true
  }
}

export function advanceBracket(matches: readonly BracketMatch[], result: BracketResult): BracketMatch[] {
  const next = new Map(matches.map((match) => [match.key, cloneMatch(match)]))
  const current = findMatch(next, result.matchKey)
  if (current.state === 'completed' || current.state === 'forfeit') throw new Error('El partido ya tiene resultado')
  if (!current.active) throw new Error('El partido no esta activo')
  if (!current.slots.a.teamId || !current.slots.b.teamId) throw new Error('El partido no tiene dos equipos')
  if (current.slots.a.teamId === current.slots.b.teamId) throw new Error('Un partido requiere dos equipos distintos')
  if (![current.slots.a.teamId, current.slots.b.teamId].includes(result.winnerTeamId)) {
    throw new Error('El ganador no pertenece al partido')
  }
  if (![current.slots.a.teamId, current.slots.b.teamId].includes(result.loserTeamId)) {
    throw new Error('El perdedor no pertenece al partido')
  }
  if (result.winnerTeamId === result.loserTeamId) throw new Error('El ganador y el perdedor deben ser distintos')

  current.winnerTeamId = result.winnerTeamId
  current.loserTeamId = result.loserTeamId
  current.state = 'completed'
  setRoutedTeam(next, current.winnerTo, result.winnerTeamId)
  setRoutedTeam(next, current.loserTo, result.loserTeamId)

  for (const destination of next.values()) {
    if (!destination.activation || destination.activation.matchKey !== current.key) continue
    const triggerTeamId = current.slots[destination.activation.winnerSlot].teamId
    if (triggerTeamId === result.winnerTeamId) {
      destination.active = true
      destination.state = 'pending'
      destination.resultReason = undefined
    }
  }

  return [...next.values()]
}
