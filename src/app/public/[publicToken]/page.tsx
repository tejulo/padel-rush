import { notFound } from 'next/navigation'
import { TournamentView } from '@/components/public/tournament-view'
import { getPublicTournament } from '@/lib/services/public'

export default async function PublicTournamentPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params
  const tournament = await getPublicTournament(publicToken)
  if (!tournament) notFound()

  return (
    <main>
      <TournamentView tournament={tournament} />
    </main>
  )
}
