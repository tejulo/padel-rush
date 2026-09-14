import { signInAction } from '@/app/actions/auth'

export function LoginForm() {
  return (
    <form action={signInAction}>
      <label htmlFor="username">Usuario</label>
      <input id="username" name="username" required autoComplete="username" />
      <label htmlFor="password">Contrasena</label>
      <input id="password" name="password" type="password" required minLength={12} autoComplete="current-password" />
      <button type="submit">Iniciar sesion</button>
    </form>
  )
}
