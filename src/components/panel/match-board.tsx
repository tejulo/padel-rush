'use client'

import { useActionState, useState } from 'react'
import {
  clearResultAction,
  moveMatchAction,
  recordForfeitAction,
  recordResultAction,
  startMatchAction,
  substitutePlayerAction,
  type ActionState,
} from '@/app/actions/matches'
import type { ProfileFormat } from '@/lib/domain/format'
import { scoreFormConfig } from '@/lib/domain/scoring'
import type { MatchBoardEntry, MatchBoardTeam } from '@/lib/services/matches'
import {
  categoryLabel,
  courtTint,
  matchStageLabel,
  matchStateLabel,
  matchTint,
  MATCH_REASON_LABELS,
} from '@/lib/ui/labels'

const initialState: ActionState = {}

function formatScore(score: unknown): string {
  if (!Array.isArray(score)) return ''
  return score.map((set) => `${(set as { home: number }).home}-${(set as { away: number }).away}`).join(', ')
}

function courtKey(entry: MatchBoardEntry): string {
  return entry.courtName ?? 'Sin cancha'
}

function reasonLabel(reason: string): string | null {
  if (reason === 'absence' || reason === 'retirement') return MATCH_REASON_LABELS[reason]
  return null
}

export function MatchBoard({
  tournamentId,
  matches,
  enabledCourts,
}: {
  tournamentId: string
  matches: MatchBoardEntry[]
  enabledCourts: { id: string; name: string }[]
}) {
  const [selected, setSelected] = useState<string | null>(null)
  if (matches.length === 0) return <p className="empty">No hay partidos generados.</p>

  const sorted = [...matches].sort((left, right) => {
    const leftTime = left.match.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    const rightTime = right.match.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER
    return leftTime - rightTime
  })
  const groups = new Map<string, MatchBoardEntry[]>()
  for (const entry of sorted) {
    const key = courtKey(entry)
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  const warningCount = matches.filter((entry) => entry.afterEndWarning).length

  return (
    <div className="stack">
      {warningCount > 0 ? (
        <p role="alert">
          {warningCount === 1
            ? '1 partido termina despues de la hora limite del torneo.'
            : `${warningCount} partidos terminan despues de la hora limite del torneo.`}
        </p>
      ) : null}
      {[...groups.entries()].map(([court, entries], courtIndex) => (
        <section key={court} className="stack">
          <h2 className={`eyebrow eyebrow--sm tint-${courtTint(courtIndex)}`}>{court}</h2>
          <ol className="match-list">
            {entries.map((entry) => {
              const { match } = entry
              const canOperate = match.state === 'scheduled' || match.state === 'in_progress'
              const canMove = match.state === 'pending' || match.state === 'scheduled'
              const isSelected = selected === match.id
              const reason = match.resultReason ? reasonLabel(match.resultReason) : null
              return (
                <li key={match.id}>
                  <article className="card">
                    <h3 className="card-title">
                      {entry.scheduledStartLabel ?? 'sin horario'} - {categoryLabel(entry.category.category)} -{' '}
                      {matchStageLabel(match.stage)}
                    </h3>
                    <div className={`card-body tint-${matchTint(match.state)}`}>
                      <p className="match-teams">
                        <strong>{entry.homeTeam?.name ?? 'por definir'}</strong> vs{' '}
                        <strong>{entry.awayTeam?.name ?? 'por definir'}</strong>
                      </p>
                      {match.score ? <p className="match-score">Marcador: {formatScore(match.score)}</p> : null}
                      <p className="meta">
                        Estado: <strong>{matchStateLabel(match.state)}</strong>
                        {reason ? ` | ${reason}` : null}
                      </p>
                      {entry.afterEndWarning ? <p role="alert">Termina despues de la hora limite del torneo.</p> : null}
                      {canOperate || canMove ? (
                        <button type="button" className="secondary" onClick={() => setSelected(isSelected ? null : match.id)}>
                          {isSelected ? 'Cerrar' : 'Operar partido'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                  {isSelected ? (
                    <MatchOperations
                      match={match}
                      tournamentId={tournamentId}
                      enabledCourts={enabledCourts}
                      homeTeam={entry.homeTeam}
                      awayTeam={entry.awayTeam}
                      format={entry.format}
                      replacementCandidates={entry.replacementCandidates}
                    />
                  ) : null}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

function SubstitutionForm({
  team,
  candidates,
}: {
  team: MatchBoardTeam
  candidates: { id: string; name: string }[]
}) {
  const [state, action, pending] = useActionState(substitutePlayerAction, initialState)

  return (
    <form action={action} className="ops-form">
      <input type="hidden" name="teamId" value={team.id} />
      <input type="hidden" name="version" value={team.version} />
      <h4 className="ops-title">Sustitucion</h4>
      <p className="meta">En {team.name} · disponible antes de su primer partido</p>
      <label>
        Sale
        <select name="outgoingParticipantId" required defaultValue="">
          <option value="">Seleccionar</option>
          {team.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Entra
        <select name="replacementParticipantId" required defaultValue="">
          <option value="">Seleccionar</option>
          {candidates
            .filter((candidate) => !team.members.some((member) => member.id === candidate.id))
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
        </select>
      </label>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.success ? <p role="status">{state.success}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Guardando...' : 'Registrar sustitucion'}
      </button>
    </form>
  )
}

function MatchOperations({
  match,
  tournamentId,
  enabledCourts,
  homeTeam,
  awayTeam,
  format,
  replacementCandidates,
}: {
  match: MatchBoardEntry['match']
  tournamentId: string
  enabledCourts: { id: string; name: string }[]
  homeTeam: MatchBoardEntry['homeTeam']
  awayTeam: MatchBoardEntry['awayTeam']
  format: ProfileFormat
  replacementCandidates: MatchBoardEntry['replacementCandidates']
}) {
  const [startState, startAction, startPending] = useActionState(startMatchAction, initialState)
  const [resultState, resultAction, resultPending] = useActionState(recordResultAction, initialState)
  const [forfeitState, forfeitAction, forfeitPending] = useActionState(recordForfeitAction, initialState)
  const [clearState, clearAction, clearPending] = useActionState(clearResultAction, initialState)
  const [moveState, moveAction, movePending] = useActionState(moveMatchAction, initialState)
  const resultForm = scoreFormConfig(format)
  const [sets, setSets] = useState(resultForm.setOptions[0]!)

  const errors = [startState.error, resultState.error, forfeitState.error, clearState.error, moveState.error].filter(Boolean)
  const successes = [startState.success, resultState.success, forfeitState.success, clearState.success, moveState.success].filter(
    Boolean,
  )
  const substitutable = [homeTeam, awayTeam].filter((team): team is MatchBoardTeam => Boolean(team?.eligibleForSubstitution))

  return (
    <div className="ops">
      {match.state === 'scheduled' ? (
        <form action={startAction} className="ops-form">
          <input type="hidden" name="matchId" value={match.id} />
          <input type="hidden" name="version" value={match.version} />
          <button type="submit" disabled={startPending}>
            {startPending ? 'Iniciando...' : 'Iniciar partido'}
          </button>
        </form>
      ) : null}
      {match.state === 'scheduled' || match.state === 'in_progress' ? (
        <form action={resultAction} className="ops-form">
          <input type="hidden" name="matchId" value={match.id} />
          <input type="hidden" name="version" value={match.version} />
          <h4 className="ops-title">Registrar resultado</h4>
          {resultForm.setOptions.length > 1 ? (
            <label>
              Sets
              <select value={sets} onChange={(event) => setSets(Number(event.target.value))}>
                {resultForm.setOptions.map((option) => (
                  <option key={option} value={option}>
                    {option} sets
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="meta">Un set a {format.games} juegos.</p>
          )}
          {Array.from({ length: sets }, (_, index) => (
            <fieldset key={index} className="card">
              <legend>Set {index + 1}</legend>
              <div className="card-body set-grid">
                <label>
                  {homeTeam?.name ?? 'Local'}
                  <input name={`home-${index}`} type="number" min="0" max={resultForm.maxGames} required />
                </label>
                <label>
                  {awayTeam?.name ?? 'Visitante'}
                  <input name={`away-${index}`} type="number" min="0" max={resultForm.maxGames} required />
                </label>
              </div>
            </fieldset>
          ))}
          <button type="submit" disabled={resultPending}>
            {resultPending ? 'Guardando...' : 'Guardar resultado'}
          </button>
        </form>
      ) : null}
      {match.state === 'scheduled' || match.state === 'in_progress' ? (
        <form action={forfeitAction} className="ops-form">
          <input type="hidden" name="matchId" value={match.id} />
          <input type="hidden" name="version" value={match.version} />
          <h4 className="ops-title">Registrar derrota automatica</h4>
          <label>
            Equipo que no se presenta
            <select name="forfeitTeamId" required>
              <option value="">Seleccionar</option>
              {homeTeam ? <option value={homeTeam.id}>{homeTeam.name}</option> : null}
              {awayTeam ? <option value={awayTeam.id}>{awayTeam.name}</option> : null}
            </select>
          </label>
          <label>
            Motivo
            <select name="reason" required>
              <option value="absence">Ausencia</option>
              <option value="retirement">Retiro</option>
            </select>
          </label>
          <button type="submit" className="caution" disabled={forfeitPending}>
            {forfeitPending ? 'Guardando...' : 'Registrar derrota automatica'}
          </button>
        </form>
      ) : null}
      {match.state === 'pending' || match.state === 'scheduled' ? (
        <form action={moveAction} className="ops-form">
          <input type="hidden" name="matchId" value={match.id} />
          <input type="hidden" name="version" value={match.version} />
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <h4 className="ops-title">Mover partido</h4>
          <div className="field-row">
            <label>
              Cancha
              <select name="courtId" defaultValue={enabledCourts[0]?.id ?? ''} required>
                {enabledCourts.map((court) => (
                  <option key={court.id} value={court.id}>
                    {court.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nueva hora
              <input name="startsAt" type="datetime-local" required />
            </label>
          </div>
          <button type="submit" className="secondary" disabled={movePending}>
            {movePending ? 'Moviendo...' : 'Mover partido'}
          </button>
        </form>
      ) : null}
      {match.state === 'completed' || match.state === 'forfeit' ? (
        <form action={clearAction} className="ops-form">
          <input type="hidden" name="matchId" value={match.id} />
          <input type="hidden" name="version" value={match.version} />
          <button type="submit" className="caution" disabled={clearPending}>
            {clearPending ? 'Corrigiendo...' : 'Corregir resultado'}
          </button>
        </form>
      ) : null}
      {substitutable.map((team) => (
        <SubstitutionForm key={team.id} team={team} candidates={replacementCandidates} />
      ))}
      {errors.map((error) => (
        <p key={error} role="alert">
          {error}
        </p>
      ))}
      {successes.map((success) => (
        <p key={success} role="status">
          {success}
        </p>
      ))}
    </div>
  )
}
