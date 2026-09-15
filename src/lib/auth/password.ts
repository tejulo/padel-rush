import argon2 from 'argon2'

export type CredentialValidation = { ok: true } | { ok: false }

export function validateCredentials(input: { username: unknown; password: unknown }): CredentialValidation {
  if (typeof input.username !== 'string' || !/^[A-Za-z0-9]{3,32}$/.test(input.username)) {
    return { ok: false }
  }

  if (typeof input.password !== 'string' || input.password.length < 12) {
    return { ok: false }
  }

  return { ok: true }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}
