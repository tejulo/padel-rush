import { expect, test } from '@playwright/test'

test('organizer signs in, creates a tournament, and opens the match board', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Usuario').fill('organizador1')
  await page.getByLabel('Contrasena').fill('padel-seguro1')
  await page.getByRole('button', { name: 'Iniciar sesion' }).click()

  await expect(page.getByRole('heading', { name: 'Torneos' })).toBeVisible()
  await page.getByRole('link', { name: 'Nuevo torneo' }).click()

  const name = `Relampago ${Date.now()}`
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Fecha').fill('2026-10-03')
  await page.getByRole('button', { name: 'Crear torneo' }).click()

  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.getByRole('link', { name: 'Partidos' }).click()
  await expect(page.getByRole('heading', { name: new RegExp(`Partidos de ${name}`) })).toBeVisible()
  await expect(page.getByText('No hay partidos generados.')).toBeVisible()
})
