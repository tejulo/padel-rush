import { isIP } from 'node:net'

function validIp(value: string | null): string | null {
  const ip = value?.trim()
  return ip && isIP(ip) ? ip : null
}

export function requestIp(headerStore: Headers): string | null {
  const realIp = validIp(headerStore.get('x-real-ip'))
  if (realIp) return realIp

  const forwardedFor = headerStore.get('x-forwarded-for')
  if (forwardedFor) {
    for (const value of forwardedFor.split(',').reverse()) {
      const ip = validIp(value)
      if (ip) return ip
    }
  }

  return null
}
