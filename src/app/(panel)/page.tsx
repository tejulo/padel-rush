import Link from 'next/link'
import { requireUser } from '@/lib/auth/guards'
import { listTournaments } from '@/lib/services/tournaments'

export default async function PanelPage() {
  const user = await requireUser()
  const tournaments = await listTournaments(user)

  return (
    <section>
      <div>
        <h1>Torneos</h1>
        <Link href="/tournaments/new">Nuevo torneo</Link>
      </div>
      {tournaments.length === 0 ? <p>No hay torneos.</p> : null}
      <ul>
        {tournaments.map((tournament) => (
          <li key={tournament.id}>
            <Link href={`/tournaments/${tournament.id}`}>
              {tournament.name} - {tournament.date} - {tournament.state}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
