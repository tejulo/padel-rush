import type { ReactNode } from 'react'
import { signOutAction } from '@/app/actions/auth'
import { requireUser } from '@/lib/auth/guards'

export default async function PanelLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await requireUser()

  return (
    <div>
      <header>
        <span>{user.username}</span>
        <form action={signOutAction}>
          <button type="submit">Cerrar sesion</button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  )
}

