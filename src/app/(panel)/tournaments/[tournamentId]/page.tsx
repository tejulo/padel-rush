import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { PublicLink } from '@/components/panel/public-link'
import { TournamentActions } from '@/components/panel/tournament-actions'
import { TournamentForm } from '@/components/panel/tournament-form'
import { formatLabel, parseFormatConfig } from '@/lib/domain/format'
import { TournamentNav } from '@/components/panel/tournament-nav'
import { assertTournamentOwner, getCategories, getTournament } from '@/lib/services/tournaments'
import { categoryLabel, categoryStateLabel, tournamentStateLabel } from '@/lib/ui/labels'

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
  const formatConfig = parseFormatConfig(tournament.formatConfig)

  return (
    <section className="stack">
      <p className="backlink">
        <Link href="/">Volver a torneos</Link>
      </p>
      <h1 className="eyebrow tint-salmon">{tournament.name}</h1>
      <p className={`tournament-state tournament-state--${tournament.state}`}>
        Estado: {tournamentStateLabel(tournament.state)}
      </p>
      <p className="meta">
        Formato: {formatLabel(formatConfig.regular)} | Finales: {formatLabel(formatConfig.finals)}
      </p>
      <TournamentNav tournamentId={tournament.id} />
      <h2 className="section-title">Canchas</h2>
      <ul className="plain-list plain-list--tight">
        {tournament.courts.map((court) => (
          <li key={court.id}>
            <p className="meta">
              {court.name}: {court.enabled ? 'habilitada' : 'deshabilitada'}
            </p>
          </li>
        ))}
      </ul>
      <h2 className="section-title">Categorias</h2>
      <ul className="plain-list plain-list--tight">
        {tournamentCategories.map((category) => (
          <li key={category.id}>
            <p className="meta">
              {categoryLabel(category.category)}: {categoryStateLabel(category.state)}
            </p>
          </li>
        ))}
      </ul>
      <h2 className="section-title">Enlace publico</h2>
      {tournament.publicToken ? (
        <PublicLink tournamentId={tournament.id} version={tournament.version} publicToken={tournament.publicToken} />
      ) : (
        <p className="meta">El enlace publico se crea al generar los cuadros.</p>
      )}
      <h2 className="section-title">Configuracion</h2>
      <TournamentForm tournament={tournament} />
      <h2 className="section-title">Acciones</h2>
      <TournamentActions
        tournamentId={tournament.id}
        version={tournament.version}
        state={tournament.state}
        isAdmin={user.role === 'admin'}
      />
    </section>
  )
}
