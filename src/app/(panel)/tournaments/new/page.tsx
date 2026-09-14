import { requireUser } from '@/lib/auth/guards'
import { TournamentForm } from '@/components/panel/tournament-form'

export default async function NewTournamentPage() {
  await requireUser()

  return (
    <section>
      <h1>Nuevo torneo</h1>
      <TournamentForm />
    </section>
  )
}
