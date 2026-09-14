import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { TournamentForm } from '@/components/panel/tournament-form'
import { assertTournamentOwner, getCategories, getTournament } from '@/lib/services/tournaments'

export default async function TournamentPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const user = await requireUser()
  const { tournamentId } = await params
  const tournament = await getTournament(tournamentId)
  if (!tournament) notFound()
  try {
    assertTournamentOwner(user, tournament)
  } catch {
    notFound()
  }
  const tournamentCategories = await getCategories(tournament.id)

  return (
    <section>
      <p>
        <Link href="/">Volver a torneos</Link>
      </p>
      <h1>{tournament.name}</h1>
      <p>Estado: {tournament.state}</p>
      <p>
        <Link href={`/tournaments/${tournament.id}/participants`}>Participantes</Link>
      </p>
      <p>
        <Link href={`/tournaments/${tournament.id}/teams`}>Parejas</Link>
      </p>
      <p>
        <Link href={`/tournaments/${tournament.id}/matches`}>Partidos</Link>
      </p>
      <h2>Canchas</h2>
      <ul>
        {tournament.courts.map((court) => (
          <li key={court.id}>
            {court.name}: {court.enabled ? 'habilitada' : 'deshabilitada'}
          </li>
        ))}
      </ul>
      <h2>Categorias</h2>
      <ul>
        {tournamentCategories.map((category) => (
          <li key={category.id}>
            {category.category}: {category.state}
          </li>
        ))}
      </ul>
      <h2>Configuracion</h2>
      <TournamentForm tournament={tournament} />
    </section>
  )
}
