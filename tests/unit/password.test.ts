import { expect, it } from 'vitest'
import { validateCredentials } from '@/lib/auth/password'

it('accepts an alphanumeric username and a 12-character password', () => {
  expect(validateCredentials({ username: 'organizador1', password: 'padel-seguro1' })).toEqual({ ok: true })
})

it('rejects usernames with spaces and short passwords', () => {
  expect(validateCredentials({ username: 'mal usuario', password: 'corta' }).ok).toBe(false)
})
