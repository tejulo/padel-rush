'use client'

import { useActionState } from 'react'
import {
  createOrganizerAction,
  deactivateOrganizerAction,
  resetPasswordAction,
  saveSettingsAction,
  type ActionState,
} from '@/app/actions/organizers'

const initialState: ActionState = {}

export function OrganizerAdmin({
  organizers,
  settings,
}: {
  organizers: { id: string; username: string; state: string }[]
  settings: { endsAt: string; shortMatchMinutes: number; longMatchMinutes: number; restMinutes: number }
}) {
  const [createState, createAction, createPending] = useActionState(createOrganizerAction, initialState)
  const [resetState, resetAction, resetPending] = useActionState(resetPasswordAction, initialState)
  const [deactivateState, deactivateAction, deactivatePending] = useActionState(deactivateOrganizerAction, initialState)
  const [settingsState, settingsAction, settingsPending] = useActionState(saveSettingsAction, initialState)

  return (
    <div>
      <form action={createAction}>
        <h2>Nuevo organizador</h2>
        <label>
          Usuario nuevo
          <input name="username" required />
        </label>
        <label>
          Contrasena nueva
          <input name="password" type="password" minLength={12} required />
        </label>
        <button type="submit" disabled={createPending}>
          {createPending ? 'Creando...' : 'Crear organizador'}
        </button>
        {createState.error ? <p role="alert">{createState.error}</p> : null}
        {createState.success ? <p role="status">{createState.success}</p> : null}
      </form>

      <h2>Cuentas</h2>
      <ul>
        {organizers.map((organizer) => (
          <li key={organizer.id}>
            <p>
              {organizer.username} - {organizer.state}
            </p>
            <form action={resetAction}>
              <input type="hidden" name="organizerId" value={organizer.id} />
              <label>
                Nueva contrasena
                <input name="password" type="password" minLength={12} required />
              </label>
              <button type="submit" disabled={resetPending}>
                Restablecer contrasena
              </button>
            </form>
            <form action={deactivateAction}>
              <input type="hidden" name="organizerId" value={organizer.id} />
              <label>
                Reasignar torneos activos a
                <select name="replacementOrganizerId" defaultValue="">
                  <option value="">Sin reasignacion</option>
                  {organizers
                    .filter((candidate) => candidate.id !== organizer.id && candidate.state === 'active')
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.username}
                      </option>
                    ))}
                </select>
              </label>
              <button type="submit" disabled={deactivatePending}>
                Desactivar
              </button>
            </form>
          </li>
        ))}
      </ul>
      {resetState.error ? <p role="alert">{resetState.error}</p> : null}
      {resetState.success ? <p role="status">{resetState.success}</p> : null}
      {deactivateState.error ? <p role="alert">{deactivateState.error}</p> : null}
      {deactivateState.success ? <p role="status">{deactivateState.success}</p> : null}

      <form action={settingsAction}>
        <h2>Ajustes predeterminados</h2>
        <label>
          Hora limite
          <input name="endsAt" type="time" defaultValue={settings.endsAt} required />
        </label>
        <label>
          Duracion corta (minutos)
          <input name="shortMatchMinutes" type="number" min="1" defaultValue={settings.shortMatchMinutes} required />
        </label>
        <label>
          Duracion larga (minutos)
          <input name="longMatchMinutes" type="number" min="1" defaultValue={settings.longMatchMinutes} required />
        </label>
        <label>
          Descanso minimo (minutos)
          <input name="restMinutes" type="number" min="0" defaultValue={settings.restMinutes} required />
        </label>
        <button type="submit" disabled={settingsPending}>
          {settingsPending ? 'Guardando...' : 'Guardar ajustes'}
        </button>
        {settingsState.error ? <p role="alert">{settingsState.error}</p> : null}
        {settingsState.success ? <p role="status">{settingsState.success}</p> : null}
      </form>
    </div>
  )
}
