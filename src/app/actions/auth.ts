'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requestIp } from '@/lib/auth/request-ip'
import { setSessionCookie, signIn, signOut } from '@/lib/auth/session'

export async function signInAction(formData: FormData) {
  const headerStore = await headers()
  const result = await signIn(
    String(formData.get('username') ?? ''),
    String(formData.get('password') ?? ''),
    requestIp(headerStore),
  )

  if (!result.ok) return

  await setSessionCookie(result.token)
  redirect('/')
}

export async function signOutAction(): Promise<void> {
  await signOut()
  redirect('/login')
}
