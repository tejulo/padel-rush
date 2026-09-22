import type { Category, CategoryState, MatchFormat, MatchStage, MatchState, TournamentState } from '@/lib/domain/types'

export const CATEGORY_LABELS: Record<Category, string> = { men: 'Masculino', women: 'Femenino', mixed: 'Mixto' }

export const TOURNAMENT_STATE_LABELS: Record<TournamentState, string> = {
  draft: 'Borrador',
  in_progress: 'En juego',
  finished: 'Finalizado',
  completed: 'Finalizado',
  cancelled: 'Cancelado',
}

export const CATEGORY_STATE_LABELS: Record<CategoryState, string> = {
  draft: 'Borrador',
  locked: 'Bloqueada',
  in_progress: 'En juego',
  finished: 'Finalizada',
  cancelled: 'Cancelada',
}

export const MATCH_STATE_LABELS: Record<MatchState, string> = {
  pending: 'Pendiente',
  scheduled: 'Programado',
  in_progress: 'En juego',
  completed: 'Finalizado',
  forfeit: 'Derrota automatica',
  cancelled: 'Cancelado',
}

export const MATCH_STAGE_LABELS: Record<MatchStage, string> = {
  'winners-round': 'Cuadro de ganadores',
  'winners-final': 'Final de ganadores',
  'losers-round': 'Cuadro de perdedores',
  'losers-final': 'Final de perdedores',
  'grand-final': 'Gran final',
  'grand-final-reset': 'Reinicio de gran final',
}

export const MATCH_REASON_LABELS: Record<'absence' | 'retirement', string> = {
  absence: 'Ausencia',
  retirement: 'Retiro',
}

export const ORGANIZER_STATE_LABELS: Record<'active' | 'inactive', string> = {
  active: 'Activo',
  inactive: 'Inactivo',
}

export const FORMAT_LABELS: Record<MatchFormat, string> = {
  'one-set-nine': 'Un set a 9 juegos',
  'best-of-three': 'Mejor de tres sets',
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

export function tournamentStateLabel(state: string): string {
  return (TOURNAMENT_STATE_LABELS as Record<string, string>)[state] ?? state
}

export function organizerStateLabel(state: string): string {
  return (ORGANIZER_STATE_LABELS as Record<string, string>)[state] ?? state
}

export function categoryStateLabel(state: string): string {
  return (CATEGORY_STATE_LABELS as Record<string, string>)[state] ?? state
}

export function matchStateLabel(state: string): string {
  return (MATCH_STATE_LABELS as Record<string, string>)[state] ?? state
}

export function matchStageLabel(stage: string): string {
  return (MATCH_STAGE_LABELS as Record<string, string>)[stage] ?? stage
}

export function categoryLabel(category: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? category
}

export function dateLabel(value: string): string {
  const [year, month, day] = value.split('-')
  const monthIndex = Number(month ?? 0) - 1
  if (!year || !day || !MONTHS[monthIndex]) return value
  return `${Number(day)} de ${MONTHS[monthIndex]} de ${year}`
}

export function tournamentTint(state: string): string {
  if (state === 'draft') return 'sky'
  if (state === 'in_progress') return 'lime'
  if (state === 'cancelled') return 'salmon'
  return 'sage'
}

export function matchTint(state: string): string {
  if (state === 'pending') return 'sky'
  if (state === 'scheduled') return 'peach'
  if (state === 'in_progress') return 'lime'
  if (state === 'forfeit') return 'salmon'
  if (state === 'cancelled') return 'steel'
  return 'sage'
}

export function categoryTint(category: string): string {
  if (category === 'men') return 'periwinkle'
  if (category === 'women') return 'peach'
  return 'olive'
}

const COURT_TINTS = ['olive', 'salmon', 'periwinkle']

export function courtTint(index: number): string {
  return COURT_TINTS[index % COURT_TINTS.length]!
}
