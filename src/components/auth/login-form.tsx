'use client'

import { useActionState } from 'react'
import { signInAction, type LoginState } from '@/app/actions/auth'

const initialState: LoginState = {}

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, initialState)

  return (
    <form action={action} className="card card--pad">
      <label htmlFor="username">Usuario</label>
      <input id="username" name="username" required autoComplete="username" />
      <label htmlFor="password">Contrasena</label>
      <input id="password" name="password" type="password" required minLength={12} autoComplete="current-password" />
      {state.error ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Ingresando...' : 'Iniciar sesion'}
      </button>
    </form>
  )
}
