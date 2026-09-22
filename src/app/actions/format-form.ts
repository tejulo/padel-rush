import { parseFormatConfig } from '@/lib/domain/format'

function value(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim()
}

export function profileFrom(formData: FormData, prefix: 'regular' | 'finals') {
  return {
    games: Number(value(formData, `${prefix}Games`)),
    sets: Number(value(formData, `${prefix}Sets`)),
    tieBreak: formData.get(`${prefix}TieBreak`) !== null,
    advantage: value(formData, `${prefix}Advantage`) === 'con-ventaja',
  }
}

export function formatConfigFrom(formData: FormData) {
  if (!formData.has('regularGames') || !formData.has('finalsGames')) return undefined
  return parseFormatConfig({ regular: profileFrom(formData, 'regular'), finals: profileFrom(formData, 'finals') })
}
