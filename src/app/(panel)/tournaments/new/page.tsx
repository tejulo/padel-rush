import { requireUser } from '@/lib/auth/guards'
import { TournamentForm } from '@/components/panel/tournament-form'
import { listActiveOrganizers } from '@/lib/services/tournaments'

export default async function NewTournamentPage() {
  const user = await requireUser()
  const organizers = user.role === 'admin' ? await listActiveOrganizers() : []

  return (
    <section>
      <h1>Nuevo torneo</h1>
      <TournamentForm isAdmin={user.role === 'admin'} organizers={organizers} />
    </section>
  )
}
