import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { HydrationMarker } from '@/components/hydration-marker'
import './globals.css'

export const metadata: Metadata = {
  title: 'Padel Rush',
  description: 'Gestion de torneos relampago de padel',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <HydrationMarker />
        {children}
      </body>
    </html>
  )
}
