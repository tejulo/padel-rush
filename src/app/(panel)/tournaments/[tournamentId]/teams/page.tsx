import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { proposeTeams } from '@/lib/domain/pairing'
import { TeamLockForm, TeamProposal, ReturnTournamentToDraftForm, StartTournamentForm } from '@/components/panel/team-proposal'
import { getParticipants } from '@/lib/services/participants'
import { getTournamentTeams } from '@/lib/services/teams'
import { assertTournamentOwner, getTournament } from '@/lib/services/tournaments'

export default async function TeamsPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const user = await requireUser()
  const { tournamentId } = await params
  const tournament = await getTournament(tournamentId)
  if (!tournament) notFound()
  try {
    assertTournamentOwner(user, tournament)
  } catch {
    notFound()
  }

  const [participantRows, categoryRows] = await Promise.all([
    getParticipants(tournament.id),
    getTournamentTeams(tournament.id),
  ])
  const editable = tournament.state === 'draft'

  return (
    <section>
      <p>
        <Link href={`/tournaments/${tournament.id}`}>Volver al torneo</Link>
      </p>
      <h1>Parejas de {tournament.name}</h1>
      <p>Las propuestas compensan niveles altos y bajos. Los cambios manuales muestran una advertencia, pero no bloquean el guardado.</p>
      {categoryRows.map((category) => {
        const registeredParticipants = participantRows
          .filter((participant) => participant.categories.includes(category.category))
          .map(({ id, name, gender, level }) => ({ id, name, gender, level }))
        const proposals = proposeTeams(category.category, registeredParticipants)
        return (
          <section key={category.id}>
            <p>Estado: {category.state}</p>
            {category.state === 'cancelled' ? (
              <p>Esta categoria fue cancelada.</p>
            ) : (
              <>
                {proposals.unpairedParticipantIds.length > 0 ? (
                  <p role="status">
                    Participantes sin pareja propuesta: {proposals.unpairedParticipantIds.join(', ')}
                  </p>
                ) : null}
                <TeamProposal
                  tournamentId={tournament.id}
                  categoryId={category.id}
                  category={category.category}
                  version={category.version}
                  editable={editable && category.state === 'draft'}
                  participants={registeredParticipants}
                  proposals={proposals}
                  savedTeams={category.teams}
                />
              </>
            )}
          </section>
        )
      })}
      {editable ? <TeamLockForm tournamentId={tournament.id} /> : null}
      {tournament.state === 'draft' && categoryRows.some((category) => category.state === 'locked') ? (
        <StartTournamentForm tournamentId={tournament.id} />
      ) : null}
      {tournament.state === 'in_progress' ? <ReturnTournamentToDraftForm tournamentId={tournament.id} /> : null}
    </section>
  )
}
