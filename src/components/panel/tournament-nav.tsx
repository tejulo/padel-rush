import Link from 'next/link'

const SECTIONS = [
  { key: 'participants', label: 'Participantes' },
  { key: 'teams', label: 'Parejas' },
  { key: 'matches', label: 'Partidos' },
] as const

export type TournamentSection = (typeof SECTIONS)[number]['key']

export function TournamentNav({
  tournamentId,
  current,
  back = false,
}: {
  tournamentId: string
  current?: TournamentSection
  back?: boolean
}) {
  return (
    <nav className="section-nav" aria-label="Secciones del torneo">
      {back ? <Link href={`/tournaments/${tournamentId}`}>Volver al torneo</Link> : null}
      {SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={`/tournaments/${tournamentId}/${section.key}`}
          aria-current={current === section.key ? 'page' : undefined}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  )
}
