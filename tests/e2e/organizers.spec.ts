import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth/password'

test('administrator manages organizer accounts and global defaults', async ({ page }) => {
  const admin = { username: 'admine2e', password: 'admin-seguro1' }
  await db.delete(users).where(eq(users.role, 'admin'))
  await db.insert(users).values({
    id: randomUUID(),
    username: admin.username,
    passwordHash: await hashPassword(admin.password),
    role: 'admin',
    state: 'active',
  })

  await page.goto('/login')
  await page.getByLabel('Usuario').fill(admin.username)
  await page.getByLabel('Contrasena').fill(admin.password)
  await page.getByRole('button', { name: 'Iniciar sesion' }).click()

  await Promise.all([
    page.waitForURL('**/admin/organizers'),
    page.getByRole('link', { name: 'Organizadores' }).click(),
  ])
  await expect(page.getByRole('heading', { name: 'Organizadores' })).toBeVisible()

  const username = `org${Date.now().toString().slice(-8)}`
  await page.getByLabel('Usuario nuevo').fill(username)
  await page.getByLabel('Contrasena nueva').fill('seguro-padel-1')
  await page.getByRole('button', { name: 'Crear organizador' }).click()
  await expect(page.getByText(`${username} - active`)).toBeVisible()

  await page.getByRole('button', { name: 'Guardar ajustes' }).click()
  await expect(page.getByText('Ajustes guardados')).toBeVisible()
})
