'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requestIp } from '@/lib/auth/request-ip'
import { INVALID_CREDENTIALS_MESSAGE, setSessionCookie, signIn, signOut } from '@/lib/auth/session'

export type LoginState = { error?: string }

export async function signInAction(_previousState: LoginState, formData: FormData): Promise<LoginState> {
  const headerStore = await headers()
  const result = await signIn(
    String(formData.get('username') ?? ''),
    String(formData.get('password') ?? ''),
    requestIp(headerStore),
  )

  if (!result.ok) return { error: INVALID_CREDENTIALS_MESSAGE }

  await setSessionCookie(result.token)
  redirect('/')
}

export async function signOutAction(): Promise<void> {
  await signOut()
  redirect('/login')
}
