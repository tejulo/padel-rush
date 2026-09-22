import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/guards'
import { proposeTeams } from '@/lib/domain/pairing'
import { TeamLockForm, TeamProposal, ReturnTournamentToDraftForm, StartTournamentForm } from '@/components/panel/team-proposal'
import { TournamentNav } from '@/components/panel/tournament-nav'
import { getParticipants } from '@/lib/services/participants'
import { getTournamentTeams } from '@/lib/services/teams'
import { assertTournamentOwner, getTournament } from '@/lib/services/tournaments'
import { categoryLabel, categoryStateLabel, categoryTint } from '@/lib/ui/labels'

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
  const activeCategoryNames = categoryRows
    .filter((category) => category.state !== 'cancelled')
    .map((category) => category.category)
  const withoutRegistration = participantRows.filter(
    (participant) => !participant.categories.some((category) => activeCategoryNames.includes(category)),
  )

  return (
    <section className="stack">
      <TournamentNav tournamentId={tournament.id} current="teams" back />
      <h1 className="eyebrow tint-peach">Parejas de {tournament.name}</h1>
      <p className="meta">
        Las propuestas compensan niveles altos y bajos. Los cambios manuales muestran una advertencia, pero no bloquean el
        guardado.
      </p>
      {withoutRegistration.length > 0 ? (
        <p role="status">
          Sin inscripcion en categorias activas: {withoutRegistration.map((participant) => participant.name).join(', ')}.
          No entran en las propuestas de parejas.
        </p>
      ) : null}
      {categoryRows.map((category) => {
        const registeredParticipants = participantRows
          .filter((participant) => participant.categories.includes(category.category))
          .map(({ id, name, gender, level }) => ({ id, name, gender, level }))
        const proposals = proposeTeams(category.category, registeredParticipants)
        return (
          <section key={category.id} className="stack">
            <h2 className={`eyebrow eyebrow--sm tint-${categoryTint(category.category)}`}>
              {categoryLabel(category.category)}
            </h2>
            <p className="meta">Estado: {categoryStateLabel(category.state)}</p>
            {category.state === 'cancelled' ? (
              <p className="empty">Esta categoria fue cancelada.</p>
            ) : (
              <>
                {proposals.unpairedParticipantIds.length > 0 ? (
                  <p role="status">
                    Participantes sin pareja propuesta:{' '}
                    {proposals.unpairedParticipantIds
                      .map((id) => {
                        const participant = registeredParticipants.find((row) => row.id === id)
                        return participant ? `${participant.name} (nivel ${participant.level})` : id
                      })
                      .join(', ')}
                  </p>
                ) : null}
                <TeamProposal
                  tournamentId={tournament.id}
                  categoryId={category.id}
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
      {tournament.state === 'draft' &&
      categoryRows.some((category) => category.state !== 'cancelled') &&
      categoryRows.filter((category) => category.state !== 'cancelled').every((category) => category.state === 'locked') ? (
        <StartTournamentForm tournamentId={tournament.id} />
      ) : null}
      {tournament.state === 'in_progress' ? <ReturnTournamentToDraftForm tournamentId={tournament.id} /> : null}
    </section>
  )
}
