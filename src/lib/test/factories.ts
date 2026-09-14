import type { CreateTournamentInput } from '@/lib/services/tournaments'

export function makeTournamentInput(): CreateTournamentInput {
  return {
    name: 'Sabado de padel',
    date: '2026-10-03',
    timezone: 'America/Argentina/Buenos_Aires',
    startsAt: '09:00',
    endsAt: '21:00',
    shortMatchMinutes: 40,
    longMatchMinutes: 90,
    restMinutes: 20,
    organizerId: 'organizer-id',
  }
}
