'use client'

import { useActionState } from 'react'
import { regeneratePublicLinkAction, type ActionState } from '@/app/actions/tournaments'

const initialState: ActionState = {}

export function PublicLink({ tournamentId, version, publicToken }: { tournamentId: string; version: number; publicToken: string }) {
  const [state, action, pending] = useActionState(regeneratePublicLinkAction, initialState)

  return (
    <div className="stack">
      <p>
        Enlace publico: <a href={`/public/${publicToken}`}>/public/{publicToken}</a>
      </p>
      <form action={action}>
        <input type="hidden" name="id" value={tournamentId} />
        <input type="hidden" name="version" value={version} />
        <button type="submit" className="caution" disabled={pending}>
          {pending ? 'Regenerando...' : 'Regenerar enlace publico'}
        </button>
      </form>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.success ? <p role="status">{state.success}</p> : null}
    </div>
  )
}
