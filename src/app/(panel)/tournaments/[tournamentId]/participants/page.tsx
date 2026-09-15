import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { ParticipantForm } from '@/components/panel/participant-form'
import { getParticipants } from '@/lib/services/participants'
import { assertTournamentOwner, getTournament } from '@/lib/services/tournaments'

export default async function ParticipantsPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const user = await requireUser()
  const { tournamentId } = await params
  const tournament = await getTournament(tournamentId)
  if (!tournament) notFound()
  try {
    assertTournamentOwner(user, tournament)
  } catch {
    notFound()
  }
  const participantRows = await getParticipants(tournament.id)
  const draft = tournament.state === 'draft'

  return (
    <section>
      <p>
        <Link href={`/tournaments/${tournament.id}`}>Volver al torneo</Link>
      </p>
      <h1>Participantes de {tournament.name}</h1>
      {!draft ? <p>Las inscripciones estan bloqueadas.</p> : null}
      {draft ? <ParticipantForm tournamentId={tournament.id} draft /> : null}
      <div>
        {participantRows.map((participant) => (
          <ParticipantForm key={participant.id} tournamentId={tournament.id} participant={participant} draft={draft} />
        ))}
      </div>
    </section>
  )
}
