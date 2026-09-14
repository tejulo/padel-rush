import { requireUser } from '@/lib/auth/guards'
import { TournamentForm } from '@/components/panel/tournament-form'
import { getGlobalSettings } from '@/lib/services/settings'
import { listActiveOrganizers } from '@/lib/services/tournaments'

export default async function NewTournamentPage() {
  const user = await requireUser()
  const [organizers, defaults] = await Promise.all([
    user.role === 'admin' ? listActiveOrganizers() : Promise.resolve([]),
    getGlobalSettings(),
  ])

  return (
    <section>
      <h1>Nuevo torneo</h1>
      <TournamentForm isAdmin={user.role === 'admin'} organizers={organizers} defaults={defaults} />
    </section>
  )
}
