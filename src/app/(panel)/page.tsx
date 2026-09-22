import Link from 'next/link'
import { requireUser } from '@/lib/auth/guards'
import { listTournaments } from '@/lib/services/tournaments'
import { dateLabel, tournamentStateLabel, tournamentTint } from '@/lib/ui/labels'

export default async function PanelPage() {
  const user = await requireUser()
  const tournaments = await listTournaments(user)

  return (
    <section className="stack">
      <h1 className="eyebrow tint-olive">Torneos</h1>
      {user.role === 'admin' ? (
        <p>
          <Link className="button secondary" href="/admin/organizers">
            Organizadores
          </Link>
        </p>
      ) : null}
      {tournaments.length === 0 ? (
        <p className="empty">No hay torneos.</p>
      ) : (
        <ul className="plain-list">
          {tournaments.map((tournament) => (
            <li key={tournament.id}>
              <article className="card">
                <h2 className="card-title">
                  <Link href={`/tournaments/${tournament.id}`}>{tournament.name}</Link>
                </h2>
                <div className={`card-body tint-${tournamentTint(tournament.state)}`}>
                  <p className="meta">{dateLabel(tournament.date)}</p>
                  <p className="meta">
                    Estado: <strong>{tournamentStateLabel(tournament.state)}</strong>
                  </p>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
