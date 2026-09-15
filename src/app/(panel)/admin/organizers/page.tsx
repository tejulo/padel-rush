import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { OrganizerAdmin } from '@/components/panel/organizer-admin'
import { getGlobalSettings } from '@/lib/services/settings'
import { listOrganizers } from '@/lib/services/users'

export default async function OrganizersPage() {
  await requireRole('admin')
  const [organizers, settings] = await Promise.all([listOrganizers(), getGlobalSettings()])

  return (
    <section>
      <p>
        <Link href="/">Volver a torneos</Link>
      </p>
      <h1>Organizadores</h1>
      <OrganizerAdmin organizers={organizers} settings={settings} />
    </section>
  )
}
