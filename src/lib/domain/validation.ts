import type { Category, Gender } from './types'

export interface ParticipantValidationInput {
  name: string
  gender: Gender
  level: number
  categories: Category[]
}

export type ValidationResult = { ok: true } | { ok: false; message: string }

export function validateParticipant(input: ParticipantValidationInput): ValidationResult {
  if (!input.name.trim()) return { ok: false, message: 'El nombre es obligatorio' }
  if (!Number.isInteger(input.level) || input.level < 1 || input.level > 5) {
    return { ok: false, message: 'El nivel debe ser un entero entre 1 y 5' }
  }

  if (input.categories.length === 0) {
    return { ok: false, message: 'El participante debe tener al menos una categoria' }
  }

  if (new Set(input.categories).size !== input.categories.length) {
    return { ok: false, message: 'No se puede repetir una categoria' }
  }

  const incompatible = input.gender === 'woman' ? 'men' : 'women'
  if (input.categories.includes(incompatible)) {
    return { ok: false, message: 'La categoria no es compatible con el genero' }
  }

  return { ok: true }
}
