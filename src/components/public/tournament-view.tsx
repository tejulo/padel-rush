import { RefreshButton } from '@/components/public/refresh-button'
import type { PublicCategory, PublicMatch, PublicTournament } from '@/lib/services/public'

const CATEGORY_LABELS: Record<string, string> = { men: 'Masculino', women: 'Femenino', mixed: 'Mixto' }

const STAGE_LABELS: Record<string, string> = {
  'winners-round': 'Cuadro de ganadores',
  'winners-final': 'Final de ganadores',
  'losers-round': 'Cuadro de perdedores',
  'losers-final': 'Final de perdedores',
  'grand-final': 'Gran final',
  'grand-final-reset': 'Reinicio de gran final',
}

const REASON_LABELS: Record<string, string> = { absence: 'Ausencia', retirement: 'Retiro' }

const STATE_LABELS: Record<string, string> = {
  draft: 'proximamente',
  in_progress: 'en juego',
  finished: 'finalizado',
  completed: 'finalizado',
  cancelled: 'cancelado',
}

function MatchList({ matches }: { matches: PublicMatch[] }) {
  if (matches.length === 0) return <p>Sin partidos todavia.</p>
  return (
    <ol>
      {matches.map((match) => (
        <li key={match.id}>
          <p>
            {match.startLabel ?? 'sin horario'} - {match.courtName ?? 'sin cancha'} - {STAGE_LABELS[match.stage] ?? match.stage}
          </p>
          <p>
            {match.homeTeam ?? 'por definir'} vs {match.awayTeam ?? 'por definir'}
          </p>
          {match.score ? <p>Marcador: {match.score}</p> : null}
          {match.resultReason ? <p>{REASON_LABELS[match.resultReason] ?? match.resultReason}</p> : null}
        </li>
      ))}
    </ol>
  )
}

function CategorySection({ category }: { category: PublicCategory }) {
  const winners = category.matches.filter((match) => match.stage.startsWith('winners') || match.stage === 'grand-final')
  const losers = category.matches.filter((match) => match.stage.startsWith('losers') || match.stage === 'grand-final-reset')

  return (
    <section>
      <h2>
        {CATEGORY_LABELS[category.name] ?? category.name} - {STATE_LABELS[category.state] ?? category.state}
      </h2>
      {category.champion ? <p role="status">Campeon: {category.champion}</p> : null}
      <h3>Parejas</h3>
      <ul>
        {category.teams.map((team) => (
          <li key={team.id}>
            {team.name}: {team.members.join(' y ')}
          </li>
        ))}
      </ul>
      <h3>Cuadro de ganadores</h3>
      <MatchList matches={winners} />
      <h3>Cuadro de perdedores</h3>
      <MatchList matches={losers} />
    </section>
  )
}

export function TournamentView({ tournament }: { tournament: PublicTournament }) {
  const finished = tournament.state === 'finished' || tournament.state === 'completed'

  return (
    <section>
      <h1>{tournament.name}</h1>
      <p role="status">Estado: {STATE_LABELS[tournament.state] ?? tournament.state}</p>
      {tournament.state === 'draft' ? <p>El torneo comienza pronto.</p> : null}
      {finished ? <p>El torneo ya termino. Consulta los resultados finales.</p> : null}
      {tournament.state === 'cancelled' ? <p>El torneo fue cancelado.</p> : null}
      <RefreshButton />
      <h2>Cuadros</h2>
      {tournament.categories.map((category) => (
        <CategorySection key={category.id} category={category} />
      ))}
    </section>
  )
}
