import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { tournaments } from '@/lib/db/schema'

test('public visitors can view the tournament without a login', async ({ browser }) => {
  const operator = await browser.newContext()
  const page = await operator.newPage()
  await page.goto('/login')
  await page.getByLabel('Usuario').fill('organizador1')
  await page.getByLabel('Contrasena').fill('padel-seguro1')
  await page.getByRole('button', { name: 'Iniciar sesion' }).click()

  const name = `Publico ${Date.now()}`
  await page.getByRole('link', { name: 'Nuevo torneo' }).click()
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Fecha').fill('2026-10-03')
  await page.getByRole('button', { name: 'Crear torneo' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()

  const [created] = await db.select().from(tournaments).where(eq(tournaments.name, name)).limit(1)
  const token = `e2e-${created!.id}`
  await db.update(tournaments).set({ publicToken: token }).where(eq(tournaments.id, created!.id))

  const anonymous = await browser.newContext()
  const publicPage = await anonymous.newPage()
  await publicPage.goto(`/public/${token}`)
  await expect(publicPage.getByRole('heading', { name })).toBeVisible()
  await expect(publicPage.getByRole('heading', { name: 'Cuadros' })).toBeVisible()
  await expect(publicPage.getByText('El torneo comienza pronto.')).toBeVisible()

  const missing = await anonymous.newPage()
  const response = await missing.goto('/public/token-inexistente')
  expect(response?.status()).toBe(404)

  await operator.close()
  await anonymous.close()
})

test('regenerating the public link revokes the previous token', async ({ browser }) => {
  const operator = await browser.newContext()
  const page = await operator.newPage()
  await page.goto('/login')
  await page.getByLabel('Usuario').fill('organizador1')
  await page.getByLabel('Contrasena').fill('padel-seguro1')
  await page.getByRole('button', { name: 'Iniciar sesion' }).click()

  const name = `Revoca ${Date.now()}`
  await page.getByRole('link', { name: 'Nuevo torneo' }).click()
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Fecha').fill('2026-10-03')
  await page.getByRole('button', { name: 'Crear torneo' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()

  const [created] = await db.select().from(tournaments).where(eq(tournaments.name, name)).limit(1)
  const oldToken = `viejo-${created!.id}`
  await db.update(tournaments).set({ publicToken: oldToken }).where(eq(tournaments.id, created!.id))

  await page.reload()
  await page.getByRole('button', { name: 'Regenerar enlace publico' }).click()
  await expect(page.getByText('Enlace publico regenerado')).toBeVisible()
  const [updated] = await db.select().from(tournaments).where(eq(tournaments.id, created!.id))
  expect(updated!.publicToken).not.toBe(oldToken)

  const anonymous = await browser.newContext()
  const revoked = await anonymous.newPage()
  const revokedResponse = await revoked.goto(`/public/${oldToken}`)
  expect(revokedResponse?.status()).toBe(404)
  const current = await anonymous.newPage()
  await current.goto(`/public/${updated!.publicToken}`)
  await expect(current.getByRole('heading', { name })).toBeVisible()

  await operator.close()
  await anonymous.close()
})
