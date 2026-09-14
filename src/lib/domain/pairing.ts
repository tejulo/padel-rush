import type { Category, Gender } from './types'

export interface PairingParticipant {
  id: string
  gender: Gender
  level: number
  name?: string
}

export interface TeamProposal {
  memberIds: string[]
  members: PairingParticipant[]
  levelTotal: number
}

export type TeamProposalList = TeamProposal[] & { readonly unpairedParticipantIds: string[] }

export type CategoryValidation =
  | { ok: true }
  | { ok: false; message: string; participantIds?: string[] }

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function descendingLevel(left: PairingParticipant, right: PairingParticipant): number {
  return right.level - left.level || compareIds(left.id, right.id)
}

function ascendingLevel(left: PairingParticipant, right: PairingParticipant): number {
  return left.level - right.level || compareIds(left.id, right.id)
}

function proposalsFromPairs(pairs: PairingParticipant[][]): TeamProposal[] {
  return pairs.map((members) => ({
    memberIds: members.map((member) => member.id),
    members,
    levelTotal: members.reduce((total, member) => total + member.level, 0),
  }))
}

function withUnpairedParticipantIds(proposals: TeamProposal[], participantIds: string[]): TeamProposalList {
  Object.defineProperty(proposals, 'unpairedParticipantIds', {
    configurable: false,
    enumerable: false,
    value: participantIds,
    writable: false,
  })
  return proposals as TeamProposalList
}

export function proposeTeams(category: Category, participants: readonly PairingParticipant[]): TeamProposalList {
  if (category === 'mixed') {
    const men = participants.filter((participant) => participant.gender === 'man').sort(descendingLevel)
    const women = participants.filter((participant) => participant.gender === 'woman').sort(ascendingLevel)
    const pairCount = Math.min(men.length, women.length)
    const pairs = Array.from({ length: pairCount }, (_, index) => [men[index]!, women[index]!])
    const unpairedParticipantIds = [...men.slice(pairCount), ...women.slice(pairCount)].map((participant) => participant.id)
    return withUnpairedParticipantIds(proposalsFromPairs(pairs), unpairedParticipantIds)
  }

  const sorted = participants.slice().sort(descendingLevel)
  const pairs: PairingParticipant[][] = []
  for (let left = 0, right = sorted.length - 1; left < right; left += 1, right -= 1) {
    pairs.push([sorted[left]!, sorted[right]!])
  }
  const unpairedParticipantIds = leftOverParticipantIds(sorted)
  return withUnpairedParticipantIds(proposalsFromPairs(pairs), unpairedParticipantIds)
}

function leftOverParticipantIds(sorted: readonly PairingParticipant[]): string[] {
  return sorted.length % 2 === 0 ? [] : [sorted[Math.floor(sorted.length / 2)]!.id]
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0
}

export function validateCategoryTeams(
  category: Category,
  teams: readonly TeamProposal[],
  expectedParticipantIds?: readonly string[],
): CategoryValidation {
  if (teams.length < 2) return { ok: false, message: 'La categoria debe tener al menos dos equipos' }
  if (teams.some((team) => !team.members)) {
    return { ok: false, message: 'Faltan los integrantes para validar los equipos' }
  }
  if (!isPowerOfTwo(teams.length)) {
    return { ok: false, message: 'La cantidad de equipos debe ser una potencia de dos' }
  }

  const participantIds = new Set<string>()
  for (const team of teams) {
    if (team.memberIds.length !== 2) {
      return { ok: false, message: 'Cada equipo debe tener exactamente dos participantes' }
    }

    const members = team.members
    if (members.length !== team.memberIds.length || members.some((member, index) => member.id !== team.memberIds[index])) {
      return { ok: false, message: 'Los integrantes del equipo no coinciden' }
    }

    for (const participantId of team.memberIds) {
      if (participantIds.has(participantId)) {
        return { ok: false, message: 'No se puede repetir un participante', participantIds: [participantId] }
      }
      participantIds.add(participantId)
    }

    const genders = members.map((member) => member.gender)
    if (category === 'mixed' && !(genders.includes('man') && genders.includes('woman'))) {
      return { ok: false, message: 'Cada equipo mixto debe tener un hombre y una mujer' }
    }
    if (category === 'men' && genders.some((gender) => gender !== 'man')) {
      return { ok: false, message: 'Los equipos masculinos solo pueden tener hombres' }
    }
    if (category === 'women' && genders.some((gender) => gender !== 'woman')) {
      return { ok: false, message: 'Los equipos femeninos solo pueden tener mujeres' }
    }
  }

  if (expectedParticipantIds) {
    const expected = new Set(expectedParticipantIds)
    const missing = [...expected].filter((participantId) => !participantIds.has(participantId))
    const extra = [...participantIds].filter((participantId) => !expected.has(participantId))
    if (missing.length > 0 || extra.length > 0) {
      return {
        ok: false,
        message: 'Los equipos no coinciden con los participantes inscriptos',
        participantIds: [...missing, ...extra],
      }
    }
  }

  return { ok: true }
}
