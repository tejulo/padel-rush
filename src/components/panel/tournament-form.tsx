'use client'

import { useActionState, useState } from 'react'
import type { ActiveOrganizer, TournamentWithCourts } from '@/lib/services/tournaments'
import {
  DEFAULT_FORMAT_CONFIG,
  formatExample,
  MAX_GAMES,
  MIN_GAMES,
  type FormatConfig,
  type ProfileFormat,
} from '@/lib/domain/format'
import { DEFAULT_TIMEZONE } from '@/lib/domain/scheduling'
import { createTournamentAction, updateTournamentAction, type ActionState } from '@/app/actions/tournaments'

const initialState: ActionState = {}

export interface TournamentDefaultValues {
  endsAt: string
  shortMatchMinutes: number
  longMatchMinutes: number
  restMinutes: number
  courtCount: number
  formatConfig: FormatConfig
}

export function TournamentForm({
  tournament,
  isAdmin = false,
  organizers = [],
  defaults,
}: {
  tournament?: TournamentWithCourts
  isAdmin?: boolean
  organizers?: ActiveOrganizer[]
  defaults?: TournamentDefaultValues
}) {
  const action = tournament ? updateTournamentAction : createTournamentAction
  const [state, formAction, pending] = useActionState(action, initialState)
  const locked = tournament?.state !== undefined && tournament.state !== 'draft'

  return (
    <form action={formAction} className="card card--pad form-grid">
      {tournament ? (
        <>
          <input type="hidden" name="id" value={tournament.id} />
          <input type="hidden" name="version" value={tournament.version} />
        </>
      ) : null}
      {!tournament && isAdmin ? (
        <label htmlFor="organizerId">
          Organizador
          <select id="organizerId" name="organizerId" required defaultValue="">
            <option value="">Selecciona un organizador activo</option>
            {organizers.map((organizer) => (
              <option key={organizer.id} value={organizer.id}>
                {organizer.username}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Nombre
        <input name="name" required defaultValue={tournament?.name ?? ''} />
      </label>
      <label>
        Fecha
        <input name="date" type="date" required defaultValue={tournament?.date ?? ''} disabled={locked} />
      </label>
      <label>
        Zona horaria
        <input name="timezone" required defaultValue={tournament?.timezone ?? DEFAULT_TIMEZONE} disabled={locked} />
      </label>
      <label>
        Hora de inicio
        <input name="startsAt" type="time" required defaultValue={tournament?.startsAt ?? '09:00'} disabled={locked} />
      </label>
      <label>
        Hora limite
        <input name="endsAt" type="time" required defaultValue={tournament?.endsAt ?? defaults?.endsAt ?? '21:00'} disabled={locked} />
      </label>
      <label>
        Duracion corta (minutos)
        <input
          name="shortMatchMinutes"
          type="number"
          min="1"
          required
          defaultValue={tournament?.shortMatchMinutes ?? defaults?.shortMatchMinutes ?? 40}
          disabled={locked}
        />
      </label>
      <label>
        Duracion larga (minutos)
        <input
          name="longMatchMinutes"
          type="number"
          min="1"
          required
          defaultValue={tournament?.longMatchMinutes ?? defaults?.longMatchMinutes ?? 90}
          disabled={locked}
        />
      </label>
      <label>
        Descanso minimo (minutos)
        <input
          name="restMinutes"
          type="number"
          min="0"
          required
          defaultValue={tournament?.restMinutes ?? defaults?.restMinutes ?? 20}
          disabled={locked}
        />
      </label>
      <label>
        Canchas habilitadas
        <input
          name="courtCount"
          type="number"
          min="1"
          max="6"
          required
          defaultValue={tournament?.courts.filter((court) => court.enabled).length ?? defaults?.courtCount ?? 3}
        />
      </label>
      <fieldset className="fieldset--flat">
        <legend>Formato de partidos</legend>
        <div className="card-grid">
          <ProfileFields
            profile="regular"
            label="Regulares"
            format={tournament?.formatConfig.regular ?? defaults?.formatConfig.regular ?? DEFAULT_FORMAT_CONFIG.regular}
            locked={locked}
          />
          <ProfileFields
            profile="finals"
            label="Finales"
            format={tournament?.formatConfig.finals ?? defaults?.formatConfig.finals ?? DEFAULT_FORMAT_CONFIG.finals}
            locked={locked}
          />
        </div>
      </fieldset>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.success ? <p role="status">{state.success}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Guardando...' : tournament ? 'Guardar cambios' : 'Crear torneo'}
      </button>
    </form>
  )
}

export function ProfileFields({
  profile,
  label,
  format,
  locked,
}: {
  profile: 'regular' | 'finals'
  label: string
  format: ProfileFormat
  locked: boolean
}) {
  const [gamesInput, setGamesInput] = useState(String(format.games))
  const [games, setGames] = useState(format.games)
  const [sets, setSets] = useState(format.sets)
  const [tieBreak, setTieBreak] = useState(format.tieBreak)
  const [advantage, setAdvantage] = useState(format.advantage)
  const example = formatExample({ games, sets, tieBreak, advantage })

  return (
    <fieldset className="fieldset--flat">
      <legend>{label}</legend>
      <div className="field-row">
        <label>
          Juegos por set
          <input
            name={`${profile}Games`}
            type="number"
            min={MIN_GAMES}
            max={MAX_GAMES}
            required
            value={gamesInput}
            disabled={locked}
            onChange={(event) => {
              setGamesInput(event.target.value)
              const parsed = Number(event.target.value)
              if (Number.isInteger(parsed) && parsed >= MIN_GAMES && parsed <= MAX_GAMES) setGames(parsed)
            }}
          />
        </label>
        <label>
          Al mejor de
          <select name={`${profile}Sets`} value={sets} disabled={locked} onChange={(event) => setSets(Number(event.target.value))}>
            <option value={1}>1 set</option>
            <option value={3}>3 sets</option>
            <option value={5}>5 sets</option>
          </select>
        </label>
      </div>
      <label>
        <input
          type="checkbox"
          name={`${profile}TieBreak`}
          checked={tieBreak}
          disabled={locked}
          onChange={(event) => setTieBreak(event.target.checked)}
        />
        Tie-break
      </label>
      {tieBreak ? (
        <label>
          Cierre del set
          <select
            name={`${profile}Advantage`}
            value={advantage ? 'con-ventaja' : 'sin-ventaja'}
            disabled={locked}
            onChange={(event) => setAdvantage(event.target.value === 'con-ventaja')}
          >
            <option value="sin-ventaja">
              Tie-break en {games - 1}-{games - 1} (sin ventaja)
            </option>
            <option value="con-ventaja">
              Tie-break en {games}-{games} (con ventaja: {games + 1}-{games - 1} o {games + 1}-{games})
            </option>
          </select>
        </label>
      ) : null}
      <p className="meta">Ejemplo: {example}</p>
    </fieldset>
  )
}
