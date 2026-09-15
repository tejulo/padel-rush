'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function RefreshButton() {
  const router = useRouter()

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(interval)
  }, [router])

  return (
    <button type="button" onClick={() => router.refresh()}>
      Actualizar ahora
    </button>
  )
}
