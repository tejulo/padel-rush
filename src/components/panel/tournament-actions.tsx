'use client'

import { useActionState } from 'react'
import { cancelTournamentAction, deleteTournamentAction, type ActionState } from '@/app/actions/tournaments'

const initialState: ActionState = {}

export function TournamentActions({
  tournamentId,
  version,
  state,
  isAdmin = false,
}: {
  tournamentId: string
  version: number
  state: string
  isAdmin?: boolean
}) {
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelTournamentAction, initialState)
  const [deleteState, deleteAction, deletePending] = useActionState(deleteTournamentAction, initialState)
  const canCancel = state === 'draft' || state === 'in_progress'
  const canDelete = isAdmin ? state === 'finished' || state === 'cancelled' : state === 'draft'

  return (
    <div className="stack">
      <div className="action-row">
        {canCancel ? (
          <form action={cancelAction}>
            <input type="hidden" name="id" value={tournamentId} />
            <input type="hidden" name="version" value={version} />
            <button type="submit" className="caution" disabled={cancelPending}>
              {cancelPending ? 'Cancelando...' : 'Cancelar torneo'}
            </button>
          </form>
        ) : null}
        {canDelete ? (
          <form action={deleteAction}>
            <input type="hidden" name="id" value={tournamentId} />
            <input type="hidden" name="version" value={version} />
            <button type="submit" className="caution" disabled={deletePending}>
              {deletePending ? 'Eliminando...' : 'Eliminar torneo'}
            </button>
          </form>
        ) : null}
      </div>
      {cancelState.error ? <p role="alert">{cancelState.error}</p> : null}
      {cancelState.success ? <p role="status">{cancelState.success}</p> : null}
      {deleteState.error ? <p role="alert">{deleteState.error}</p> : null}
    </div>
  )
}
