import type { ReactNode } from 'react'
import { requireUser } from '@/lib/auth/guards'

export default async function PanelLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await requireUser()

  return (
    <div>
      <header>{user.username}</header>
      <main>{children}</main>
    </div>
  )
}
