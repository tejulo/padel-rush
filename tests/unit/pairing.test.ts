import { describe, expect, it } from 'vitest'
import { proposeTeams, validateCategoryTeams, type PairingParticipant, type TeamProposal } from '@/lib/domain/pairing'

function player(id: string, level: number): PairingParticipant {
  return { id, gender: 'man', level }
}

function man(id: string, level: number): PairingParticipant {
  return { id, gender: 'man', level }
}

function woman(id: string, level: number): PairingParticipant {
  return { id, gender: 'woman', level }
}

describe('team pairing', () => {
  it('pairs highest and lowest levels in a same-gender category', () => {
    const teams = proposeTeams('men', [player('a', 5), player('b', 4), player('c', 2), player('d', 1)])

    expect(teams.map((team) => team.levelTotal)).toEqual([6, 6])
    expect(teams.map((team) => team.memberIds)).toEqual([
      ['a', 'd'],
      ['b', 'c'],
    ])
  })

  it('uses stable participant ids to break same-level ties', () => {
    const teams = proposeTeams('women', [woman('b', 3), woman('a', 3), woman('d', 1), woman('c', 1)])

    expect(teams.map((team) => team.memberIds)).toEqual([
      ['a', 'd'],
      ['b', 'c'],
    ])
  })

  it('pairs descending men with ascending women in mixed', () => {
    const teams = proposeTeams('mixed', [man('m5', 5), man('m2', 2), woman('w1', 1), woman('w4', 4)])

    expect(teams.map((team) => team.memberIds)).toEqual([
      ['m5', 'w1'],
      ['m2', 'w4'],
    ])
  })

  it('returns mixed participants left without a partner', () => {
    const teams = proposeTeams('mixed', [man('m1', 5), woman('w1', 1), woman('w2', 2)])

    expect(teams.map((team) => team.memberIds)).toEqual([['m1', 'w1']])
    expect(teams.unpairedParticipantIds).toEqual(['w2'])
  })

  it('requires a power-of-two number of complete teams', () => {
    const teams: TeamProposal[] = [
      { memberIds: ['a', 'b'], levelTotal: 5 },
      { memberIds: ['c', 'd'], levelTotal: 5 },
      { memberIds: ['e', 'f'], levelTotal: 5 },
    ]

    expect(validateCategoryTeams('men', teams)).toMatchObject({
      ok: false,
      message: expect.stringContaining('potencia de dos'),
    })
  })

  it('rejects duplicate participants in a category', () => {
    const teams: TeamProposal[] = [
      { memberIds: ['a', 'b'], levelTotal: 5 },
      { memberIds: ['b', 'c'], levelTotal: 5 },
    ]

    expect(validateCategoryTeams('men', teams)).toMatchObject({
      ok: false,
      message: expect.stringContaining('repetir'),
    })
  })

  it('requires one man and one woman in every mixed team', () => {
    const teams: TeamProposal[] = [
      {
        memberIds: ['m1', 'm2'],
        members: [man('m1', 5), man('m2', 1)],
        levelTotal: 6,
      },
      {
        memberIds: ['w1', 'w2'],
        members: [woman('w1', 5), woman('w2', 1)],
        levelTotal: 6,
      },
    ]

    expect(validateCategoryTeams('mixed', teams)).toMatchObject({
      ok: false,
      message: expect.stringContaining('hombre y una mujer'),
    })
  })
})
