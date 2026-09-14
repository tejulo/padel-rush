import { expect, it } from 'vitest'
import { validateParticipant } from '@/lib/domain/validation'

it('allows a level from 1 to 5', () => {
  expect(validateParticipant({ name: 'Ana', gender: 'woman', level: 5, categories: ['women', 'mixed'] })).toEqual({
    ok: true,
  })
})

it('rejects an incompatible category', () => {
  expect(validateParticipant({ name: 'Ana', gender: 'woman', level: 3, categories: ['men'] }).ok).toBe(false)
})

it('rejects a non-integer level outside the allowed range', () => {
  expect(validateParticipant({ name: 'Ana', gender: 'woman', level: 5.5, categories: ['women'] })).toEqual({
    ok: false,
    message: 'El nivel debe ser un entero entre 1 y 5',
  })
})

it('rejects an empty participant name', () => {
  expect(validateParticipant({ name: '  ', gender: 'man', level: 1, categories: ['men'] })).toEqual({
    ok: false,
    message: 'El nombre es obligatorio',
  })
})
