import Link from 'next/link'
import type { ReactNode } from 'react'

export function SiteBanner({ brandHref, children }: { brandHref?: string; children?: ReactNode }) {
  const brand = (
    <>
      <span className="brand-name">Padel Rush</span>
      <span className="brand-tagline">Torneos relampago de padel</span>
    </>
  )

  return (
    <header className="site-banner">
      {brandHref ? (
        <Link className="brand" href={brandHref}>
          {brand}
        </Link>
      ) : (
        <span className="brand">{brand}</span>
      )}
      {children ? <div className="banner-actions">{children}</div> : null}
    </header>
  )
}
