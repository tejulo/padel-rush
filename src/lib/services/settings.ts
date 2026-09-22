import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { requireRole } from '@/lib/auth/guards'
import { appSettings } from '@/lib/db/schema'
import { defaultFormatConfig, parseFormatConfig, type FormatConfig } from '@/lib/domain/format'
import { tournamentDefaults } from '@/lib/services/tournaments'

export interface GlobalSettings {
  endsAt: string
  shortMatchMinutes: number
  longMatchMinutes: number
  restMinutes: number
  formatConfig: FormatConfig
}

export async function getGlobalSettings(): Promise<GlobalSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'defaults')).limit(1)
  const value = (row?.value ?? {}) as Partial<GlobalSettings>
  return {
    endsAt: value.endsAt ?? tournamentDefaults.endsAt,
    shortMatchMinutes: value.shortMatchMinutes ?? tournamentDefaults.shortMatchMinutes,
    longMatchMinutes: value.longMatchMinutes ?? tournamentDefaults.longMatchMinutes,
    restMinutes: value.restMinutes ?? tournamentDefaults.restMinutes,
    formatConfig: parseFormatConfig(value.formatConfig ?? defaultFormatConfig()),
  }
}

type SaveGlobalSettingsInput = Omit<GlobalSettings, 'formatConfig'> & { formatConfig?: FormatConfig }

export async function saveGlobalSettings(input: SaveGlobalSettingsInput): Promise<GlobalSettings> {
  await requireRole('admin')
  if (!input.endsAt) throw new Error('Falta la hora limite')
  if (!Number.isInteger(input.shortMatchMinutes) || input.shortMatchMinutes <= 0) throw new Error('Duracion corta invalida')
  if (!Number.isInteger(input.longMatchMinutes) || input.longMatchMinutes <= 0) throw new Error('Duracion larga invalida')
  if (!Number.isInteger(input.restMinutes) || input.restMinutes < 0) throw new Error('Descanso invalido')

  const formatConfig = parseFormatConfig(input.formatConfig ?? defaultFormatConfig())
  const settings: GlobalSettings = {
    endsAt: input.endsAt,
    shortMatchMinutes: input.shortMatchMinutes,
    longMatchMinutes: input.longMatchMinutes,
    restMinutes: input.restMinutes,
    formatConfig,
  }

  await db
    .insert(appSettings)
    .values({ key: 'defaults', value: settings })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: settings, updatedAt: new Date() } })
  return settings
}
