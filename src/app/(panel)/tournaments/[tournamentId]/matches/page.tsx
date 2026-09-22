import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { MatchBoard } from '@/components/panel/match-board'
import { TournamentNav } from '@/components/panel/tournament-nav'
import { listTournamentMatches } from '@/lib/services/matches'
import { assertTournamentOwner, getTournament } from '@/lib/services/tournaments'

export default async function MatchesPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const user = await requireUser()
  const { tournamentId } = await params
  const tournament = await getTournament(tournamentId)
  if (!tournament) notFound()
  try {
    assertTournamentOwner(user, tournament)
  } catch {
    notFound()
  }
  const matchRows = await listTournamentMatches(tournament.id)
  const enabledCourts = tournament.courts.filter((court) => court.enabled).map((court) => ({ id: court.id, name: court.name }))

  return (
    <section className="stack">
      <TournamentNav tournamentId={tournament.id} current="matches" back />
      <h1 className="eyebrow tint-periwinkle">Partidos de {tournament.name}</h1>
      <MatchBoard tournamentId={tournament.id} matches={matchRows} enabledCourts={enabledCourts} />
    </section>
  )
}
