'use client'

import { useActionState } from 'react'
import type { ActiveOrganizer, TournamentWithCourts } from '@/lib/services/tournaments'
import { createTournamentAction, updateTournamentAction, type ActionState } from '@/app/actions/tournaments'

const initialState: ActionState = {}

export interface TournamentDefaultValues {
  endsAt: string
  shortMatchMinutes: number
  longMatchMinutes: number
  restMinutes: number
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
  const enabledCourtCount = tournament?.courts.filter((court) => court.enabled).length === 2 ? 2 : 3
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
        <input name="timezone" required defaultValue={tournament?.timezone ?? 'America/Argentina/Buenos_Aires'} disabled={locked} />
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
      <fieldset className="fieldset--flat">
        <legend>Canchas habilitadas</legend>
        <label>
          <input type="radio" name="enabledCourtCount" value="2" defaultChecked={enabledCourtCount === 2} />
          Dos cubiertas
        </label>
        <label>
          <input type="radio" name="enabledCourtCount" value="3" defaultChecked={enabledCourtCount === 3} />
          Tres canchas
        </label>
      </fieldset>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.success ? <p role="status">{state.success}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Guardando...' : tournament ? 'Guardar cambios' : 'Crear torneo'}
      </button>
    </form>
  )
}
