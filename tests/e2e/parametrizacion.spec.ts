import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { categories, participants, registrations, tournaments } from '@/lib/db/schema'

test.describe.configure({ mode: 'serial', timeout: 90_000 })

test('runs a tournament with a custom one-set format without tie-break', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Usuario').fill('organizador1')
  await page.getByLabel('Contrasena').fill('padel-seguro1')
  await page.getByRole('button', { name: 'Iniciar sesion' }).click()

  const name = `Custom ${Date.now()}`
  await page.getByRole('link', { name: 'Nuevo torneo' }).click()
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Fecha').fill('2026-10-03')
  await page.getByLabel('Canchas habilitadas').fill('2')
  await page.getByLabel('Juegos por set').first().fill('6')
  await page.getByLabel('Al mejor de').first().selectOption('1')
  await page.getByLabel('Tie-break').first().uncheck()
  await page.getByLabel('Juegos por set').nth(1).fill('6')
  await page.getByLabel('Al mejor de').nth(1).selectOption('1')
  await page.getByLabel('Tie-break').nth(1).uncheck()
  await page.getByRole('button', { name: 'Crear torneo' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(
    page.getByText('Formato: Un set a 6 juegos, cierre directo | Finales: Un set a 6 juegos, cierre directo'),
  ).toBeVisible()

  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.name, name)).limit(1)
  const categoryRows = await db.select().from(categories).where(eq(categories.tournamentId, tournament!.id)).orderBy(asc(categories.category))
  const menCategory = categoryRows.find((category) => category.category === 'men')!
  await db
    .update(categories)
    .set({ state: 'cancelled', version: 2 })
    .where(
      inArray(
        categories.id,
        categoryRows.filter((row) => row.id !== menCategory.id).map((row) => row.id),
      ),
    )
  const participantRows = await db
    .insert(participants)
    .values(
      Array.from({ length: 4 }, (_, index) => ({
        id: randomUUID(),
        tournamentId: tournament!.id,
        name: `Jugador ${index + 1}`,
        gender: 'man' as const,
        level: 3,
      })),
    )
    .returning()
  await db.insert(registrations).values(
    participantRows.map((participant) => ({ id: randomUUID(), participantId: participant.id, categoryId: menCategory.id })),
  )

  await page.getByRole('link', { name: 'Parejas' }).click()
  await page.getByRole('button', { name: 'Guardar parejas' }).click()
  await expect(page.getByText('Equipos guardados')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar y bloquear parejas' }).click()
  await expect(page.getByText('Equipos bloqueados')).toBeVisible()
  await page.getByRole('button', { name: 'Iniciar torneo y generar cuadros' }).click()
  await expect(page.getByRole('button', { name: 'Volver a borrador' })).toBeVisible()

  await page.getByRole('link', { name: 'Partidos' }).click()
  await expect(page.getByRole('heading', { name: /Partidos de/ })).toBeVisible({ timeout: 15_000 })
  const item = page.locator('li', { hasText: 'Final de ganadores' }).first()
  await item.getByRole('button', { name: 'Operar partido' }).click()
  await expect(item.getByText('Un set a 6 juegos.')).toBeVisible()
  const homeInput = item.locator('input[name="home-0"]')
  await expect(homeInput).toHaveAttribute('max', '6')
  await homeInput.fill('6')
  await item.locator('input[name="away-0"]').fill('4')
  await item.getByRole('button', { name: 'Guardar resultado' }).click()
  await expect(item.getByText('Resultado guardado')).toBeVisible()
})
