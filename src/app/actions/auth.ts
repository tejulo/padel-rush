'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { setSessionCookie, signIn, signOut } from '@/lib/auth/session'

function requestIp(headerStore: Headers): string {
  const forwardedFor = headerStore.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || 'unknown'
  return headerStore.get('x-real-ip')?.trim() || 'unknown'
}

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
