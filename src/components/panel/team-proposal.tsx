'use client'

import { useActionState, useState } from 'react'
import {
  cancelCategoryAction,
  lockTeamsAction,
  returnTournamentToDraftAction,
  saveTeamsAction,
  type ActionState,
} from '@/app/actions/teams'
import type { PairingParticipant, TeamProposal as DomainTeamProposal } from '@/lib/domain/pairing'
import type { TeamWithMembers } from '@/lib/services/teams'

interface DraftTeam {
  memberIds: string[]
  name?: string
}

const initialState: ActionState = {}

function teamTotal(team: DraftTeam, participants: readonly PairingParticipant[]): number {
  const levels = new Map(participants.map((participant) => [participant.id, participant.level]))
  return team.memberIds.reduce((total, memberId) => total + (levels.get(memberId) ?? 0), 0)
}

export function TeamProposal({
  tournamentId,
  categoryId,
  category,
  version,
  editable,
  participants,
  proposals,
  savedTeams,
}: {
  tournamentId: string
  categoryId: string
  category: 'men' | 'women' | 'mixed'
  version: number
  editable: boolean
  participants: PairingParticipant[]
  proposals: DomainTeamProposal[]
  savedTeams: TeamWithMembers[]
}) {
  const initialTeams: DraftTeam[] = savedTeams.length
    ? savedTeams.map((team) => ({ name: team.name, memberIds: team.members.map((member) => member.id) }))
    : proposals.map((team, index) => ({ name: `Pareja ${index + 1}`, memberIds: team.memberIds }))
  const [draftTeams, setDraftTeams] = useState<DraftTeam[]>(initialTeams)
  const [state, formAction, pending] = useActionState(saveTeamsAction, initialState)
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelCategoryAction, initialState)
  const totals = draftTeams.map((team) => teamTotal(team, participants))
  const spread = totals.length ? Math.max(...totals) - Math.min(...totals) : 0

  function updateMember(teamIndex: number, memberIndex: number, memberId: string) {
    setDraftTeams((current) =>
      current.map((team, index) =>
        index === teamIndex
          ? { ...team, memberIds: team.memberIds.map((id, position) => (position === memberIndex ? memberId : id)) }
          : team,
      ),
    )
  }

  function addTeam() {
    setDraftTeams((current) => [...current, { name: `Pareja ${current.length + 1}`, memberIds: ['', ''] }])
  }

  function removeTeam(teamIndex: number) {
    setDraftTeams((current) => current.filter((_, index) => index !== teamIndex))
  }

  return (
    <article>
      <h3>{category === 'men' ? 'Masculino' : category === 'women' ? 'Femenino' : 'Mixto'}</h3>
      {proposals.length === 0 ? <p>No hay suficientes inscriptos para proponer parejas.</p> : null}
      {proposals.length > 0 && proposals.some((proposal) => proposal.levelTotal !== totals[proposals.indexOf(proposal)]) ? (
        <p>La propuesta combina niveles para reducir la diferencia entre parejas.</p>
      ) : null}
      {editable ? (
        <form action={formAction}>
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="version" value={version} />
          <input type="hidden" name="teams" value={JSON.stringify(draftTeams)} />
          <div>
            {draftTeams.map((team, teamIndex) => (
              <fieldset key={`${team.name ?? 'pareja'}-${teamIndex}`}>
                <legend>{team.name ?? `Pareja ${teamIndex + 1}`} ({totals[teamIndex] ?? 0})</legend>
                {[0, 1].map((memberIndex) => (
                  <label key={memberIndex}>
                    Integrante {memberIndex + 1}
                    <select
                      value={team.memberIds[memberIndex] ?? ''}
                      onChange={(event) => updateMember(teamIndex, memberIndex, event.target.value)}
                    >
                      <option value="">Seleccionar participante</option>
                      {participants.map((participant) => (
                        <option key={participant.id} value={participant.id}>
                          {participant.name ?? participant.id} (nivel {participant.level})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <button type="button" onClick={() => removeTeam(teamIndex)} disabled={pending}>
                  Quitar pareja
                </button>
              </fieldset>
            ))}
          </div>
          {spread > 2 ? <p role="status">Advertencia: los niveles de las parejas estan desbalanceados.</p> : null}
          {state.error ? <p role="alert">{state.error}</p> : null}
          {state.success ? <p role="status">{state.success}</p> : null}
          <button type="button" onClick={addTeam} disabled={pending}>
            Agregar pareja
          </button>
          <button type="submit" disabled={pending}>
            {pending ? 'Guardando...' : 'Guardar parejas'}
          </button>
        </form>
      ) : (
        <ul>
          {savedTeams.map((team) => (
            <li key={team.id}>
              {team.name}: {team.members.map((member) => member.name ?? member.id).join(' y ')} ({team.levelTotal})
            </li>
          ))}
        </ul>
      )}
      {cancelState.error ? <p role="alert">{cancelState.error}</p> : null}
      {cancelState.success ? <p role="status">{cancelState.success}</p> : null}
      {editable ? (
        <form action={cancelAction}>
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="version" value={version} />
          <button type="submit" disabled={cancelPending}>
            {cancelPending ? 'Cancelando...' : 'Cancelar categoria'}
          </button>
        </form>
      ) : null}
    </article>
  )
}

export function TeamLockForm({ tournamentId }: { tournamentId: string }) {
  const [state, formAction, pending] = useActionState(lockTeamsAction, initialState)
  return (
    <form action={formAction}>
      <input type="hidden" name="tournamentId" value={tournamentId} />
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.success ? <p role="status">{state.success}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Bloqueando...' : 'Confirmar y bloquear parejas'}
      </button>
    </form>
  )
}

export function ReturnTournamentToDraftForm({ tournamentId }: { tournamentId: string }) {
  const [state, formAction, pending] = useActionState(returnTournamentToDraftAction, initialState)
  return (
    <form action={formAction}>
      <input type="hidden" name="tournamentId" value={tournamentId} />
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.success ? <p role="status">{state.success}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Volviendo...' : 'Volver a borrador'}
      </button>
    </form>
  )
}
