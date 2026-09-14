'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/guards'
import type { ActionState } from '@/app/actions/tournaments'
import { createOrganizer, deactivateOrganizer, listOrganizers, resetOrganizerPassword } from '@/lib/services/users'

export type { ActionState } from '@/app/actions/tournaments'

function value(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim()
}

function errorState(error: unknown): ActionState {
  return { error: error instanceof Error ? error.message : 'No se pudo guardar el organizador' }
}

export async function resetPasswordAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('admin')
  try {
    await resetOrganizerPassword(value(formData, 'organizerId'), value(formData, 'password'))
  } catch (error) {
    return errorState(error)
  }

  revalidatePath('/admin/organizers')
  return { success: 'Contrasena restablecida' }
}

export async function deactivateOrganizerAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('admin')
  const replacementOrganizerId = value(formData, 'replacementOrganizerId')
  try {
    await deactivateOrganizer(
      value(formData, 'organizerId'),
      replacementOrganizerId || undefined,
    )
  } catch (error) {
    return errorState(error)
  }

  revalidatePath('/admin/organizers')
  return { success: 'Organizador desactivado' }
}

export async function createOrganizerAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('admin')
  try {
    await createOrganizer({ username: value(formData, 'username'), password: value(formData, 'password') })
  } catch (error) {
    return errorState(error)
  }

  revalidatePath('/admin/organizers')
  return { success: 'Organizador creado' }
}

export async function listOrganizerOptions() {
  await requireRole('admin')
  return listOrganizers()
}

export async function saveSettingsAction(_previousState: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole('admin')
  try {
    const { saveGlobalSettings } = await import('@/lib/services/settings')
    await saveGlobalSettings({
      endsAt: value(formData, 'endsAt'),
      shortMatchMinutes: Number(value(formData, 'shortMatchMinutes')),
      longMatchMinutes: Number(value(formData, 'longMatchMinutes')),
      restMinutes: Number(value(formData, 'restMinutes')),
    })
  } catch (error) {
    return errorState(error)
  }

  revalidatePath('/admin/organizers')
  return { success: 'Ajustes guardados' }
}
