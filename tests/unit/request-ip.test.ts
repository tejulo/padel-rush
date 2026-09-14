import { describe, expect, it } from 'vitest'
import { requestIp } from '@/lib/auth/request-ip'

describe('request IP extraction', () => {
  it('prefers a valid trusted x-real-ip header', () => {
    expect(requestIp(new Headers({ 'x-real-ip': '198.51.100.10', 'x-forwarded-for': '203.0.113.10' }))).toBe(
      '198.51.100.10',
    )
  })

  it('uses the rightmost valid x-forwarded-for address', () => {
    expect(requestIp(new Headers({ 'x-forwarded-for': '198.51.100.10, not-an-ip, 203.0.113.10' }))).toBe(
      '203.0.113.10',
    )
  })

  it('ignores invalid proxy headers', () => {
    expect(requestIp(new Headers({ 'x-real-ip': 'not-an-ip', 'x-forwarded-for': 'also-not-an-ip' }))).toBe('unknown')
  })
})
