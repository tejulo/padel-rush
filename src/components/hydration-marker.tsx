'use client'

import { useEffect } from 'react'

export function HydrationMarker() {
  useEffect(() => {
    document.body.dataset.hydrated = 'true'
  }, [])

  return null
}
