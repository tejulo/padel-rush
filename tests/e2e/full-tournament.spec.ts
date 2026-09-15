import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { categories, participants, registrations, tournaments } from '@/lib/db/schema'

test.describe.configure({ mode: 'serial' })

test('runs a two-team category through a reset final to a finished tournament', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Usuario').fill('organizador1')
  await page.getByLabel('Contrasena').fill('padel-seguro1')
  await page.getByRole('button', { name: 'Iniciar sesion' }).click()

  const name = `Completo ${Date.now()}`
  await page.getByRole('link', { name: 'Nuevo torneo' }).click()
  await page.getByLabel('Nombre').fill(name)
  await page.getByLabel('Fecha').fill('2026-10-03')
  await page.getByRole('button', { name: 'Crear torneo' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()

  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.name, name)).limit(1)
  const categoryRows = await db.select().from(categories).where(eq(categories.tournamentId, tournament!.id)).orderBy(asc(categories.category))
  const menCategory = categoryRows.find((category) => category.category === 'men')!
  await db
    .update(categories)
    .set({ state: 'cancelled', version: 2 })
    .where(and(eq(categories.tournamentId, tournament!.id), inArray(categories.id, categoryRows.filter((row) => row.id !== menCategory.id).map((row) => row.id))))

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
  await expect
    .poll(async () => {
      const [row] = await db.select({ state: tournaments.state }).from(tournaments).where(eq(tournaments.id, tournament!.id))
      return row?.state
    })
    .toBe('in_progress')

  const [started] = await db.select().from(tournaments).where(eq(tournaments.id, tournament!.id))
  expect(started!.publicToken).toBeTruthy()

  await page.getByRole('link', { name: 'Volver al torneo' }).click()
  await page.getByRole('link', { name: 'Partidos' }).click()
  await expect(page.getByRole('heading', { name: /Partidos de/ })).toBeVisible()

  const playBestOfThree = async (stage: string, homeScores: string[], awayScores: string[]) => {
    const item = page.locator('li', { hasText: stage }).first()
    await item.getByRole('button', { name: 'Operar partido' }).click()
    await item.getByLabel('Sets').selectOption('2')
    for (let index = 0; index < 2; index += 1) {
      await item.locator(`input[name="home-${index}"]`).fill(homeScores[index]!)
      await item.locator(`input[name="away-${index}"]`).fill(awayScores[index]!)
    }
    await item.getByRole('button', { name: 'Guardar resultado' }).click()
    await expect(item.getByText('Resultado guardado')).toBeVisible()
  }

  await playBestOfThree('Final de ganadores', ['6', '6'], ['0', '0'])
  await playBestOfThree('Gran final', ['0', '0'], ['6', '6'])
  await expect(page.getByText('Reinicio de gran final').first()).toBeVisible()
  await playBestOfThree('Reinicio de gran final', ['6', '6'], ['3', '3'])

  await expect
    .poll(async () => {
      const [row] = await db.select({ state: tournaments.state }).from(tournaments).where(eq(tournaments.id, tournament!.id))
      return row?.state
    })
    .toBe('finished')

  const publicPage = await page.context().newPage()
  await publicPage.goto(`/public/${started!.publicToken}`)
  await expect(publicPage.getByRole('heading', { name })).toBeVisible()
  await expect(publicPage.getByText('El torneo ya termino. Consulta los resultados finales.')).toBeVisible()
})
