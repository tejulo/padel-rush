'use client'

import { useActionState, useState } from 'react'
import {
  clearResultAction,
  moveMatchAction,
  recordForfeitAction,
  recordResultAction,
  startMatchAction,
  type ActionState,
} from '@/app/actions/matches'
import type { MatchBoardEntry } from '@/lib/services/matches'

const initialState: ActionState = {}

const STATE_LABELS: Record<string, string> = {
  pending: 'pendiente',
  scheduled: 'programado',
  in_progress: 'en juego',
  completed: 'finalizado',
  forfeit: 'derrota automatica',
  cancelled: 'cancelado',
}

const STAGE_LABELS: Record<string, string> = {
  'winners-round': 'Cuadro de ganadores',
  'winners-final': 'Final de ganadores',
  'losers-round': 'Cuadro de perdedores',
  'losers-final': 'Final de perdedores',
  'grand-final': 'Gran final',
  'grand-final-reset': 'Reinicio de gran final',
}

const CATEGORY_LABELS: Record<string, string> = { men: 'Masculino', women: 'Femenino', mixed: 'Mixto' }

function formatTime(date: Date | string | null): string {
  if (!date) return 'sin horario'
  const value = date instanceof Date ? date : new Date(date)
  return value.toISOString().slice(11, 16)
}

function formatScore(score: unknown): string {
  if (!Array.isArray(score)) return ''
  return score.map((set) => `${(set as { home: number }).home}-${(set as { away: number }).away}`).join(', ')
}

function courtKey(entry: MatchBoardEntry): string {
  return entry.courtName ?? 'Sin cancha'
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
  if (matches.length === 0) return <p>No hay partidos generados.</p>

  const groups = new Map<string, MatchBoardEntry[]>()
  for (const entry of matches) {
    const key = courtKey(entry)
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }

  return (
    <div>
      {[...groups.entries()].map(([court, entries]) => (
        <section key={court}>
          <h2>{court}</h2>
          <ol>
            {entries.map((entry) => {
              const { match } = entry
              const canOperate = match.state === 'scheduled' || match.state === 'in_progress'
              const canMove = match.state === 'pending' || match.state === 'scheduled'
              const isSelected = selected === match.id
              return (
                <li key={match.id}>
                  <p>
                    {formatTime(match.scheduledStartAt)} - <strong>{CATEGORY_LABELS[entry.category.category]}</strong> -{' '}
                    {STAGE_LABELS[match.stage] ?? match.stage} - {STATE_LABELS[match.state] ?? match.state}
                  </p>
                  <p>
                    {entry.homeTeam?.name ?? 'por definir'} vs {entry.awayTeam?.name ?? 'por definir'}
                  </p>
                  {match.score ? <p>Marcador: {formatScore(match.score)}</p> : null}
                  {match.resultReason && match.resultReason !== 'conditional-reset' ? (
                    <p>{match.resultReason === 'absence' ? 'Ausencia' : 'Retiro'}</p>
                  ) : null}
                  {canOperate || canMove ? (
                    <button type="button" onClick={() => setSelected(isSelected ? null : match.id)}>
                      {isSelected ? 'Cerrar' : 'Operar partido'}
                    </button>
                  ) : null}
                  {isSelected ? (
                    <MatchOperations
                      match={match}
                      tournamentId={tournamentId}
                      enabledCourts={enabledCourts}
                      homeTeam={entry.homeTeam}
                      awayTeam={entry.awayTeam}
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

function MatchOperations({
  match,
  tournamentId,
  enabledCourts,
  homeTeam,
  awayTeam,
}: {
  match: MatchBoardEntry['match']
  tournamentId: string
  enabledCourts: { id: string; name: string }[]
  homeTeam: MatchBoardEntry['homeTeam']
  awayTeam: MatchBoardEntry['awayTeam']
}) {
  const [startState, startAction, startPending] = useActionState(startMatchAction, initialState)
  const [resultState, resultAction, resultPending] = useActionState(recordResultAction, initialState)
  const [forfeitState, forfeitAction, forfeitPending] = useActionState(recordForfeitAction, initialState)
  const [clearState, clearAction, clearPending] = useActionState(clearResultAction, initialState)
  const [moveState, moveAction, movePending] = useActionState(moveMatchAction, initialState)
  const [sets, setSets] = useState(1)

  const errors = [startState.error, resultState.error, forfeitState.error, clearState.error, moveState.error].filter(Boolean)
  const successes = [startState.success, resultState.success, forfeitState.success, clearState.success, moveState.success].filter(
    Boolean,
  )

  return (
    <div>
      {match.state === 'scheduled' ? (
        <form action={startAction}>
          <input type="hidden" name="matchId" value={match.id} />
          <input type="hidden" name="version" value={match.version} />
          <button type="submit" disabled={startPending}>
            {startPending ? 'Iniciando...' : 'Iniciar partido'}
          </button>
        </form>
      ) : null}
      {match.state === 'scheduled' || match.state === 'in_progress' ? (
        <form action={resultAction}>
          <input type="hidden" name="matchId" value={match.id} />
          <input type="hidden" name="version" value={match.version} />
          <label>
            Sets
            <select value={sets} onChange={(event) => setSets(Number(event.target.value))}>
              <option value={1}>1 set</option>
              <option value={2}>2 sets</option>
              <option value={3}>3 sets</option>
            </select>
          </label>
          {Array.from({ length: sets }, (_, index) => (
            <fieldset key={index}>
              <legend>Set {index + 1}</legend>
              <label>
                {homeTeam?.name ?? 'Local'}
                <input name={`home-${index}`} type="number" min="0" max="9" required />
              </label>
              <label>
                {awayTeam?.name ?? 'Visitante'}
                <input name={`away-${index}`} type="number" min="0" max="9" required />
              </label>
            </fieldset>
          ))}
          <button type="submit" disabled={resultPending}>
            {resultPending ? 'Guardando...' : 'Guardar resultado'}
          </button>
        </form>
      ) : null}
      {match.state === 'scheduled' || match.state === 'in_progress' ? (
        <form action={forfeitAction}>
          <input type="hidden" name="matchId" value={match.id} />
          <input type="hidden" name="version" value={match.version} />
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
          <button type="submit" disabled={forfeitPending}>
            {forfeitPending ? 'Guardando...' : 'Registrar derrota automatica'}
          </button>
        </form>
      ) : null}
      {match.state === 'pending' || match.state === 'scheduled' ? (
        <form action={moveAction}>
          <input type="hidden" name="matchId" value={match.id} />
          <input type="hidden" name="tournamentId" value={tournamentId} />
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
          <button type="submit" disabled={movePending}>
            {movePending ? 'Moviendo...' : 'Mover partido'}
          </button>
        </form>
      ) : null}
      {match.state === 'completed' || match.state === 'forfeit' ? (
        <form action={clearAction}>
          <input type="hidden" name="matchId" value={match.id} />
          <input type="hidden" name="version" value={match.version} />
          <button type="submit" disabled={clearPending}>
            {clearPending ? 'Corrigiendo...' : 'Corregir resultado'}
          </button>
        </form>
      ) : null}
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
