import { redirect } from 'next/navigation'
import { getSessionUser, type Role, type SessionUser } from '@/lib/auth/session'

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}

export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== role) redirect('/')
  return user
}
