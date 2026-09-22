import type { ReactNode } from 'react'
import Link from 'next/link'
import { signOutAction } from '@/app/actions/auth'
import { SiteBanner } from '@/components/site-banner'
import { requireUser } from '@/lib/auth/guards'

export default async function PanelLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await requireUser()

  return (
    <>
      <SiteBanner brandHref="/">
        <span className="banner-user">{user.username}</span>
        <form action={signOutAction}>
          <button type="submit">Cerrar sesion</button>
        </form>
        <Link className="sticker" href="/tournaments/new">
          Nuevo torneo
        </Link>
      </SiteBanner>
      <main className="site-main">{children}</main>
    </>
  )
}
