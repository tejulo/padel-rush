import { RefreshButton } from '@/components/public/refresh-button'
import type { PublicCategory, PublicMatch, PublicTournament } from '@/lib/services/public'
import {
  categoryLabel,
  categoryStateLabel,
  categoryTint,
  matchStageLabel,
  MATCH_REASON_LABELS,
  tournamentStateLabel,
} from '@/lib/ui/labels'

function MatchList({ matches }: { matches: PublicMatch[] }) {
  if (matches.length === 0) return <p className="empty">Sin partidos todavia.</p>
  return (
    <ol className="match-list">
      {matches.map((match) => (
        <li key={match.id}>
          <article className={`pub-match pub-match--${match.state}`}>
            <p className="pub-meta">
              {match.startLabel ?? 'sin horario'} - {match.courtName ?? 'sin cancha'} - {matchStageLabel(match.stage)}
            </p>
            <p className="pub-teams">
              <strong>{match.homeTeam ?? 'por definir'}</strong> vs <strong>{match.awayTeam ?? 'por definir'}</strong>
            </p>
            {match.score ? <p className="pub-score">{match.score}</p> : null}
            {match.resultReason === 'absence' || match.resultReason === 'retirement' ? (
              <p className="pub-reason">{MATCH_REASON_LABELS[match.resultReason]}</p>
            ) : null}
            {match.state === 'in_progress' ? <span className="sticker">En juego</span> : null}
          </article>
        </li>
      ))}
    </ol>
  )
}

function CategorySection({ category }: { category: PublicCategory }) {
  const winners = category.matches.filter((match) => match.stage.startsWith('winners') || match.stage === 'grand-final')
  const losers = category.matches.filter((match) => match.stage.startsWith('losers') || match.stage === 'grand-final-reset')

  return (
    <section className="stack">
      <h2 className={`eyebrow eyebrow--sm tint-${categoryTint(category.name)}`}>
        {categoryLabel(category.name)}
      </h2>
      {category.state === 'cancelled' ? null : <p className="meta">Estado: {categoryStateLabel(category.state)}</p>}
      {category.champion ? (
        <p className="champion" role="status">
          Campeon: {category.champion}
        </p>
      ) : null}
      {category.state === 'cancelled' ? (
        <p className="notice">Esta categoria fue cancelada.</p>
      ) : (
        <>
          <h3 className="section-title section-title--sm">Parejas</h3>
          {category.teams.length > 0 ? (
            <ul className="plain-list">
              {category.teams.map((team) => (
                <li key={team.id}>
                  <p className="meta">
                    {team.name}: {team.members.join(' y ')}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">Sin parejas confirmadas.</p>
          )}
          <h3 className="section-title section-title--sm">Cuadro de ganadores</h3>
          <MatchList matches={winners} />
          <h3 className="section-title section-title--sm">Cuadro de perdedores</h3>
          <MatchList matches={losers} />
        </>
      )}
    </section>
  )
}

export function TournamentView({ tournament }: { tournament: PublicTournament }) {
  const finished = tournament.state === 'finished' || tournament.state === 'completed'

  return (
    <section className="stack">
      <h1 className="eyebrow tint-olive">{tournament.name}</h1>
      <div className="status-row">
        <p className={`tournament-state tournament-state--${tournament.state}`} role="status">
          Estado: {tournamentStateLabel(tournament.state)}
        </p>
        <RefreshButton />
      </div>
      {tournament.state === 'draft' ? <p className="notice">El torneo comienza pronto.</p> : null}
      {finished ? <p className="notice">El torneo ya termino. Consulta los resultados finales.</p> : null}
      {tournament.state === 'cancelled' ? <p className="notice notice--error">El torneo fue cancelado.</p> : null}
      <h2 className="section-title">Canchas</h2>
      <ul className="plain-list plain-list--tight">
        {tournament.courts.map((court) => (
          <li key={court.name}>
            <p className="meta">
              {court.name}: {court.enabled ? 'habilitada' : 'fuera de servicio'}
            </p>
          </li>
        ))}
      </ul>
      <h2 className="section-title">Cuadros</h2>
      {tournament.categories.map((category) => (
        <CategorySection key={category.id} category={category} />
      ))}
    </section>
  )
}
