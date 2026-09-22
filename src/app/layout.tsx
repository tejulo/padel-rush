import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'Padel Rush',
  description: 'Gestion de torneos relampago de padel',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <div className="frame">
          {children}
          <footer className="site-footer">
            <p>Padel Rush - Gestion de torneos relampago de padel</p>
          </footer>
        </div>
      </body>
    </html>
  )
}
