import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { ParticipantForm } from '@/components/panel/participant-form'
import { TournamentNav } from '@/components/panel/tournament-nav'
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
    <section className="stack">
      <TournamentNav tournamentId={tournament.id} current="participants" back />
      <h1 className="eyebrow tint-sky">Participantes de {tournament.name}</h1>
      {!draft ? <p className="notice">Las inscripciones estan bloqueadas.</p> : null}
      {draft ? <ParticipantForm tournamentId={tournament.id} draft /> : null}
      {participantRows.length === 0 ? (
        <p className="empty">Sin participantes inscriptos.</p>
      ) : (
        <div className="card-grid">
          {participantRows.map((participant) => (
            <ParticipantForm key={participant.id} tournamentId={tournament.id} participant={participant} draft={draft} />
          ))}
        </div>
      )}
    </section>
  )
}
