# Parametrizacion de formato y canchas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el formato de partidos (juegos por set, sets por partido, tie-break, ventaja) y la cantidad de canchas en configuracion por torneo, con defaults que reproducen exactamente las reglas actuales.

**Architecture:** Un modulo de dominio nuevo (`format.ts`) define `FormatConfig` y sus validaciones; `tournaments.format_config` (jsonb) guarda la config copiada de los Ajustes globales al crear; `matches.profile` (`regular` | `finals`) elige que perfil aplica; `scoring.ts` valida contra el `ProfileFormat` resuelto. La UI agrega los campos al formulario de torneo y a los Ajustes.

**Tech Stack:** Next.js 16 App Router + TypeScript, Drizzle ORM + PostgreSQL, Vitest (unit/integracion), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-09-21-parametrizacion-formato-canchas-design.md`

## Global Constraints

- Defaults exactos: `regular { games: 9, sets: 1, tieBreak: true, advantage: false }`, `finals { games: 6, sets: 3, tieBreak: true, advantage: true }`.
- Rangos exactos: `games` entero 4-9; `sets` en {1, 3, 5}; `courtCount` entero 1-6. Tie-break fijo a 7 puntos con 2 de diferencia.
- Nunca correr tests ni migraciones contra la base real `padel_rush`; usar `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test`.
- Antes de correr E2E: verificar que el puerto 3000 no tenga un dev server apuntando a la base real (Playwright reutiliza el server existente y el global setup resetea la base). Pararlo o levantarlo con `DATABASE_URL=...padel_rush_test`.
- Postgres local: `docker compose up -d postgres`.
- Migraciones: `npm run db:generate` y luego `DATABASE_URL=...padel_rush_test npm run db:migrate`. No aplicar a la base de desarrollo/real sin avisar al usuario.
- Textos de UI y mensajes en español sin tildes (convencion del repo); identificadores en ingles; sin comentarios en el codigo.
- Cada tarea cierra en verde con `npx tsc --noEmit`, `npm run lint` y los tests indicados, y termina con un commit (estilo del repo: `feat:`, `test:`, `refactor:`, `docs:`).
- No cambiar el comportamiento por defecto de ningun flujo existente.

---

## File Structure

- `src/lib/domain/format.ts` (nuevo): tipos, defaults, parseo/validacion, etiquetas y ejemplos del formato.
- `src/lib/domain/scoring.ts`: validacion de marcadores parametrica.
- `src/lib/domain/bracket.ts`: `BracketMatch.profile` y `profileForStage`.
- `src/lib/domain/scheduling.ts`: `SchedulingMatch.profile`.
- `src/lib/domain/types.ts`: se elimina `MatchFormat`.
- `src/lib/db/schema.ts` + `drizzle/*` (migraciones): `tournaments.format_config`, `matches.profile`.
- `src/lib/services/tournaments.ts`: defaults, persistencia, validaciones, canchas 1-6.
- `src/lib/services/settings.ts`: defaults globales con `courtCount` y `formatConfig`.
- `src/lib/services/matches.ts`: resolucion del perfil, validacion, forfeit, duracion, `MatchBoardEntry.format`.
- `src/lib/services/scheduling.ts`: duracion por perfil.
- `src/lib/services/brackets.ts`: escribe `profile`.
- `src/lib/services/public.ts`: quita `format` sin uso.
- `src/app/actions/tournaments.ts` y `src/app/actions/organizers.ts`: parseo de campos nuevos.
- `src/components/panel/tournament-form.tsx`, `organizer-admin.tsx`, `match-board.tsx`: UI.
- `src/app/(panel)/tournaments/[tournamentId]/page.tsx`: linea de formato.
- `src/lib/ui/labels.ts`: borra `FORMAT_LABELS`.
- Tests: `tests/unit/format.test.ts` (nuevo), `tests/unit/scoring.test.ts`, `tests/unit/scheduling.test.ts`, `tests/integration/{tournaments,matches,brackets,teams,schema}.test.ts`, `tests/e2e/parametrizacion.spec.ts` (nuevo).

---

### Task 1: Modulo de dominio `format.ts`

**Files:**
- Create: `src/lib/domain/format.ts`
- Test: `tests/unit/format.test.ts`

**Interfaces:**
- Consumes: `MatchStage` de `@/lib/domain/types`.
- Produces: `MatchProfile`, `ProfileFormat`, `FormatConfig`, `DEFAULT_FORMAT_CONFIG`, `MIN_GAMES`, `MAX_GAMES`, `SET_OPTIONS`, `defaultFormatConfig()`, `parseFormatConfig(value: unknown): FormatConfig`, `formatLabel(format: ProfileFormat): string`, `formatExample(format: ProfileFormat): string`, `profileForStage(stage: MatchStage): MatchProfile`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FORMAT_CONFIG,
  defaultFormatConfig,
  formatExample,
  formatLabel,
  parseFormatConfig,
  profileForStage,
} from '@/lib/domain/format'

describe('format config', () => {
  it('reproduces the current rules as defaults', () => {
    expect(DEFAULT_FORMAT_CONFIG).toEqual({
      regular: { games: 9, sets: 1, tieBreak: true, advantage: false },
      finals: { games: 6, sets: 3, tieBreak: true, advantage: true },
    })
    expect(defaultFormatConfig()).toEqual(DEFAULT_FORMAT_CONFIG)
  })

  it('accepts valid configs and normalizes advantage without tie-break', () => {
    const parsed = parseFormatConfig({
      regular: { games: 6, sets: 1, tieBreak: false, advantage: true },
      finals: { games: 8, sets: 5, tieBreak: true, advantage: true },
    })
    expect(parsed.regular).toEqual({ games: 6, sets: 1, tieBreak: false, advantage: false })
    expect(parsed.finals).toEqual({ games: 8, sets: 5, tieBreak: true, advantage: true })
  })

  it('rejects out-of-range games, sets and shapes', () => {
    expect(() =>
      parseFormatConfig({ regular: { games: 3, sets: 1, tieBreak: true, advantage: false }, finals: DEFAULT_FORMAT_CONFIG.finals }),
    ).toThrow('Los juegos por set deben estar entre 4 y 9')
    expect(() =>
      parseFormatConfig({ regular: { games: 6, sets: 2, tieBreak: true, advantage: false }, finals: DEFAULT_FORMAT_CONFIG.finals }),
    ).toThrow('La cantidad de sets debe ser 1, 3 o 5')
    expect(() => parseFormatConfig(null)).toThrow('El formato del torneo es invalido')
  })

  it('labels and examples derive from the config', () => {
    expect(formatLabel(DEFAULT_FORMAT_CONFIG.regular)).toBe('Un set a 9 juegos, tie-break en 8-8')
    expect(formatLabel(DEFAULT_FORMAT_CONFIG.finals)).toBe('Al mejor de 3 sets a 6 juegos, con ventaja y tie-break en 6-6')
    expect(formatLabel({ games: 6, sets: 1, tieBreak: false, advantage: false })).toBe('Un set a 6 juegos, cierre directo')
    expect(formatExample(DEFAULT_FORMAT_CONFIG.regular)).toBe('9-7 o 9-8')
    expect(formatExample(DEFAULT_FORMAT_CONFIG.finals)).toBe('6-4, 7-5 o 7-6')
  })

  it('maps final stages to the finals profile', () => {
    expect(profileForStage('grand-final')).toBe('finals')
    expect(profileForStage('grand-final-reset')).toBe('finals')
    expect(profileForStage('winners-final')).toBe('finals')
    expect(profileForStage('losers-final')).toBe('finals')
    expect(profileForStage('winners-round')).toBe('regular')
    expect(profileForStage('losers-round')).toBe('regular')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/unit/format.test.ts`
Expected: FAIL con "Cannot find module '@/lib/domain/format'".

- [ ] **Step 3: Write minimal implementation**

```ts
import type { MatchStage } from '@/lib/domain/types'

export type MatchProfile = 'regular' | 'finals'

export interface ProfileFormat {
  games: number
  sets: number
  tieBreak: boolean
  advantage: boolean
}

export interface FormatConfig {
  regular: ProfileFormat
  finals: ProfileFormat
}

export const MIN_GAMES = 4
export const MAX_GAMES = 9
export const SET_OPTIONS = [1, 3, 5] as const

export const DEFAULT_FORMAT_CONFIG: FormatConfig = {
  regular: { games: 9, sets: 1, tieBreak: true, advantage: false },
  finals: { games: 6, sets: 3, tieBreak: true, advantage: true },
}

const FINAL_STAGES: readonly MatchStage[] = ['winners-final', 'losers-final', 'grand-final', 'grand-final-reset']

export function profileForStage(stage: MatchStage): MatchProfile {
  return FINAL_STAGES.includes(stage) ? 'finals' : 'regular'
}

export function defaultFormatConfig(): FormatConfig {
  return {
    regular: { ...DEFAULT_FORMAT_CONFIG.regular },
    finals: { ...DEFAULT_FORMAT_CONFIG.finals },
  }
}

function parseProfile(value: unknown, profile: 'regulares' | 'finales'): ProfileFormat {
  if (!value || typeof value !== 'object') throw new Error(`El formato de los partidos ${profile} es invalido`)
  const candidate = value as Partial<ProfileFormat>
  if (!Number.isInteger(candidate.games) || candidate.games! < MIN_GAMES || candidate.games! > MAX_GAMES) {
    throw new Error('Los juegos por set deben estar entre 4 y 9')
  }
  if (!SET_OPTIONS.includes(candidate.sets as (typeof SET_OPTIONS)[number])) {
    throw new Error('La cantidad de sets debe ser 1, 3 o 5')
  }
  if (typeof candidate.tieBreak !== 'boolean') throw new Error(`El formato de los partidos ${profile} es invalido`)
  const advantage = candidate.tieBreak && candidate.advantage === true
  return { games: candidate.games!, sets: candidate.sets!, tieBreak: candidate.tieBreak, advantage }
}

export function parseFormatConfig(value: unknown): FormatConfig {
  if (!value || typeof value !== 'object') throw new Error('El formato del torneo es invalido')
  const candidate = value as Partial<FormatConfig>
  return {
    regular: parseProfile(candidate.regular, 'regulares'),
    finals: parseProfile(candidate.finals, 'finales'),
  }
}

export function formatLabel(format: ProfileFormat): string {
  const header =
    format.sets === 1 ? `Un set a ${format.games} juegos` : `Al mejor de ${format.sets} sets a ${format.games} juegos`
  if (!format.tieBreak) return `${header}, cierre directo`
  if (!format.advantage) return `${header}, tie-break en ${format.games - 1}-${format.games - 1}`
  return `${header}, con ventaja y tie-break en ${format.games}-${format.games}`
}

export function formatExample(format: ProfileFormat): string {
  const normal = `${format.games}-${format.games - 2}`
  if (!format.tieBreak || !format.advantage) return `${normal} o ${format.games}-${format.games - 1}`
  return `${normal}, ${format.games + 1}-${format.games - 1} o ${format.games + 1}-${format.games}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/unit/format.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/format.ts tests/unit/format.test.ts
git commit -m "feat: add tournament format domain module"
```

---

### Task 2: Esquema y persistencia del formato

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/<timestamp>_tournament_format_config.sql` (generado por drizzle-kit y verificado)
- Modify: `src/lib/services/tournaments.ts`
- Modify: `src/lib/services/settings.ts`
- Test: `tests/integration/tournaments.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_FORMAT_CONFIG`, `defaultFormatConfig()`, `parseFormatConfig()`, `FormatConfig` (Task 1).
- Produces: columna `tournaments.format_config`; `tournamentDefaults.formatConfig`; `CreateTournamentInput.formatConfig?: FormatConfig`; `UpdateTournamentInput.formatConfig?: FormatConfig`; `GlobalSettings.formatConfig: FormatConfig`; `TournamentDefaultValues` (UI, Task 5) consumira `formatConfig`.

- [ ] **Step 1: Agregar la columna al esquema**

En `src/lib/db/schema.ts`, importar el tipo y el default:

```ts
import { DEFAULT_FORMAT_CONFIG, type FormatConfig } from '@/lib/domain/format'
```

En `tournaments`, despues de `restMinutes`:

```ts
    formatConfig: jsonb('format_config').notNull().$type<FormatConfig>().default(DEFAULT_FORMAT_CONFIG),
```

- [ ] **Step 2: Generar y revisar la migracion**

Run: `npm run db:generate`
Expected: aparece un SQL nuevo en `drizzle/` con `ALTER TABLE "tournaments" ADD COLUMN "format_config" jsonb DEFAULT '{"regular":...}'::jsonb NOT NULL;`. Verificar que el default JSON sea exactamente `{"regular":{"games":9,"sets":1,"tieBreak":true,"advantage":false},"finals":{"games":6,"sets":3,"tieBreak":true,"advantage":true}}`.

- [ ] **Step 3: Write the failing test**

Agregar a `tests/integration/tournaments.test.ts` (usa `makeTournamentInput`, `createTournament`, `updateTournament`, `getGlobalSettings`, `saveGlobalSettings`; importar `defaultFormatConfig` de `@/lib/domain/format`):

```ts
  it('copies the default format config and persists a custom one', async () => {
    const defaults = await createTournament(makeTournamentInput())
    expect(defaults.formatConfig).toEqual(defaultFormatConfig())

    const custom = await createTournament(
      makeTournamentInput({
        name: 'Formato custom',
        formatConfig: {
          regular: { games: 6, sets: 1, tieBreak: false, advantage: false },
          finals: { games: 6, sets: 3, tieBreak: true, advantage: true },
        },
      }),
    )
    expect(custom.formatConfig.regular).toEqual({ games: 6, sets: 1, tieBreak: false, advantage: false })

    const updated = await updateTournament({
      id: custom.id,
      version: custom.version,
      formatConfig: {
        regular: { games: 8, sets: 1, tieBreak: true, advantage: false },
        finals: custom.formatConfig.finals,
      },
    })
    expect(updated.formatConfig.regular.games).toBe(8)
  })

  it('rejects format changes after the tournament starts', async () => {
    const tournament = await createTournament(makeTournamentInput())
    await db.update(tournaments).set({ state: 'in_progress' }).where(eq(tournaments.id, tournament.id))
    await expect(
      updateTournament({
        id: tournament.id,
        version: tournament.version,
        formatConfig: {
          regular: { games: 6, sets: 1, tieBreak: true, advantage: false },
          finals: tournament.formatConfig.finals,
        },
      }),
    ).rejects.toThrow('El torneo ya iniciado no permite cambiar su configuracion')
  })

  it('persists global format defaults and fills missing values', async () => {
    await saveGlobalSettings({
      endsAt: '22:00',
      shortMatchMinutes: 35,
      longMatchMinutes: 80,
      restMinutes: 15,
      formatConfig: {
        regular: { games: 6, sets: 1, tieBreak: false, advantage: false },
        finals: { games: 6, sets: 3, tieBreak: true, advantage: true },
      },
    })
    const settings = await getGlobalSettings()
    expect(settings.formatConfig.regular).toEqual({ games: 6, sets: 1, tieBreak: false, advantage: false })
  })
```

- [ ] **Step 4: Run test to verify it fails**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/integration/tournaments.test.ts`
Expected: FAIL con errores de tipos (`formatConfig` no existe en los inputs) y `formatConfig` ausente en `GlobalSettings`.

- [ ] **Step 5: Implementar el servicio y los ajustes**

En `src/lib/services/tournaments.ts`:

```ts
import { DEFAULT_FORMAT_CONFIG, defaultFormatConfig, parseFormatConfig, type FormatConfig } from '@/lib/domain/format'
```

```ts
export const tournamentDefaults = {
  endsAt: '21:00',
  shortMatchMinutes: 40,
  longMatchMinutes: 90,
  restMinutes: 20,
  formatConfig: DEFAULT_FORMAT_CONFIG,
} as const
```

Agregar `formatConfig?: FormatConfig` a `CreateTournamentInput` y `UpdateTournamentInput`. En `ResolvedTournamentInput` agregar `formatConfig: FormatConfig` al `Omit` y al tipo:

```ts
type ResolvedTournamentInput = Omit<
  CreateTournamentInput,
  'endsAt' | 'shortMatchMinutes' | 'longMatchMinutes' | 'restMinutes' | 'formatConfig'
> & {
  endsAt: string
  shortMatchMinutes: number
  longMatchMinutes: number
  restMinutes: number
  formatConfig: FormatConfig
}
```

En `resolveWithGlobalSettings`:

```ts
    formatConfig: parseFormatConfig(input.formatConfig ?? defaults.formatConfig),
```

En `assertTournamentInput` agregar al final (el parseo ya valida rangos):

```ts
  if (input.formatConfig !== undefined) parseFormatConfig(input.formatConfig)
```

En `assertUpdateInput`, pasar `formatConfig: input.formatConfig` dentro del objeto que arma. En `createTournament`, agregar `formatConfig: resolved.formatConfig` al `insert`. En `updateTournament`:

```ts
    const immutableFields = [
      'date',
      'timezone',
      'startsAt',
      'endsAt',
      'shortMatchMinutes',
      'longMatchMinutes',
      'restMinutes',
      'formatConfig',
    ] as const
```

y en el `set`:

```ts
        ...(input.formatConfig === undefined ? {} : { formatConfig: parseFormatConfig(input.formatConfig) }),
```

En `src/lib/services/settings.ts`:

```ts
import { defaultFormatConfig, parseFormatConfig, type FormatConfig } from '@/lib/domain/format'

export interface GlobalSettings {
  endsAt: string
  shortMatchMinutes: number
  longMatchMinutes: number
  restMinutes: number
  formatConfig: FormatConfig
}
```

En `getGlobalSettings`:

```ts
    formatConfig: parseFormatConfig(value.formatConfig ?? defaultFormatConfig()),
```

En `saveGlobalSettings`, validar y persistir:

```ts
  const formatConfig = parseFormatConfig(input.formatConfig)
  const settings: GlobalSettings = {
    endsAt: input.endsAt,
    shortMatchMinutes: input.shortMatchMinutes,
    longMatchMinutes: input.longMatchMinutes,
    restMinutes: input.restMinutes,
    formatConfig,
  }
```

y usar `settings` en el `insert`/`onConflictDoUpdate` y en el `return`.

- [ ] **Step 6: Run test to verify it passes**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/integration/tournaments.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts drizzle src/lib/services/tournaments.ts src/lib/services/settings.ts tests/integration/tournaments.test.ts
git commit -m "feat: persist tournament format config with global defaults"
```

---

### Task 3: Motor de puntuacion configurable

**Files:**
- Modify: `src/lib/domain/scoring.ts`
- Modify: `src/lib/domain/scheduling.ts`
- Modify: `src/lib/services/matches.ts`
- Modify: `src/lib/services/scheduling.ts`
- Modify: `src/components/panel/match-board.tsx`
- Test: `tests/unit/scoring.test.ts`, `tests/unit/scheduling.test.ts`

**Interfaces:**
- Consumes: `ProfileFormat`, `defaultFormatConfig()`, `profileForStage()` (Task 1); `tournaments.formatConfig` (Task 2).
- Produces: `validateScore(format: ProfileFormat, sets)`, `scoreFormConfig(format: ProfileFormat)`, `SchedulingMatch.profile`, `MatchBoardEntry.format: ProfileFormat`.

- [ ] **Step 1: Reescribir los tests unitarios**

Reemplazar `tests/unit/scoring.test.ts` por:

```ts
import { describe, expect, it } from 'vitest'
import type { ProfileFormat } from '@/lib/domain/format'
import { scoreFormConfig, validateScore } from '@/lib/domain/scoring'

const regular: ProfileFormat = { games: 9, sets: 1, tieBreak: true, advantage: false }
const finals: ProfileFormat = { games: 6, sets: 3, tieBreak: true, advantage: true }
const directSix: ProfileFormat = { games: 6, sets: 1, tieBreak: false, advantage: false }
const bestOfFive: ProfileFormat = { games: 6, sets: 5, tieBreak: true, advantage: true }

describe('score validation', () => {
  it('accepts the relampago regular set and rejects anything above nine games', () => {
    expect(validateScore(regular, [{ home: 9, away: 8 }]).ok).toBe(true)
    expect(validateScore(regular, [{ home: 9, away: 7 }]).ok).toBe(true)
    expect(validateScore(regular, [{ home: 8, away: 7 }]).ok).toBe(false)
    expect(validateScore(regular, [{ home: 10, away: 8 }]).ok).toBe(false)
    expect(validateScore(regular, [{ home: 9, away: 9 }]).ok).toBe(false)
  })

  it('accepts tennis sets with advantage and tie-break', () => {
    expect(validateScore(finals, [{ home: 6, away: 4 }, { home: 7, away: 6 }]).ok).toBe(true)
    expect(validateScore(finals, [{ home: 7, away: 5 }, { home: 6, away: 4 }]).ok).toBe(true)
    expect(validateScore(finals, [{ home: 6, away: 5 }, { home: 6, away: 4 }]).ok).toBe(false)
    expect(validateScore(finals, [{ home: 8, away: 6 }, { home: 6, away: 0 }]).ok).toBe(false)
  })

  it('closes directly when the tie-break is off', () => {
    expect(validateScore(directSix, [{ home: 6, away: 5 }]).ok).toBe(true)
    expect(validateScore(directSix, [{ home: 6, away: 4 }]).ok).toBe(true)
    expect(validateScore(directSix, [{ home: 7, away: 6 }]).ok).toBe(false)
    expect(validateScore(directSix, [{ home: 6, away: 5 }, { home: 6, away: 5 }]).ok).toBe(false)
  })

  it('requires the needed sets and rejects dead sets', () => {
    expect(validateScore(finals, [{ home: 6, away: 0 }, { home: 6, away: 4 }, { home: 0, away: 6 }]).ok).toBe(false)
    expect(validateScore(finals, [{ home: 7, away: 6 }, { home: 4, away: 6 }, { home: 6, away: 2 }]).ok).toBe(true)
    expect(validateScore(bestOfFive, [{ home: 6, away: 0 }, { home: 6, away: 4 }, { home: 6, away: 2 }]).ok).toBe(true)
    expect(validateScore(bestOfFive, [{ home: 6, away: 0 }, { home: 6, away: 4 }, { home: 6, away: 2 }, { home: 6, away: 1 }]).ok).toBe(false)
    expect(validateScore(bestOfFive, [{ home: 6, away: 0 }, { home: 6, away: 4 }]).ok).toBe(false)
  })
})

describe('score form configuration', () => {
  it('derives the set options and the maximum game count', () => {
    expect(scoreFormConfig(regular)).toEqual({ setOptions: [1], maxGames: 9 })
    expect(scoreFormConfig(finals)).toEqual({ setOptions: [2, 3], maxGames: 7 })
    expect(scoreFormConfig(directSix)).toEqual({ setOptions: [1], maxGames: 6 })
    expect(scoreFormConfig(bestOfFive)).toEqual({ setOptions: [3, 4, 5], maxGames: 7 })
  })
})
```

En `tests/unit/scheduling.test.ts`, reemplazar el campo `format` de los fixtures por `profile` y el import:

```ts
import type { MatchProfile } from '@/lib/domain/format'

function makeMatch(id: string, participantIds: string[], readyAt: Date, profile: MatchProfile = 'regular') {
  return { id, participantIds, readyAt, profile, dependentCount: 0 }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/unit/scoring.test.ts tests/unit/scheduling.test.ts`
Expected: FAIL por tipos (`ProfileFormat` no es el primer parametro) y por `profile` inexistente.

- [ ] **Step 3: Implementar scoring**

Reemplazar el contenido de `src/lib/domain/scoring.ts` (salvo `ScoreSet` y `ScoreValidation`) por:

```ts
import type { ProfileFormat } from '@/lib/domain/format'

export interface ScoreSet {
  home: number
  away: number
}

export type ScoreValidation =
  | { ok: true; winner: 'home' | 'away' }
  | { ok: false; message: string }

function isGameScore(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

function validSet(set: ScoreSet, format: ProfileFormat): boolean {
  if (!set || typeof set !== 'object') return false
  if (!isGameScore(set.home) || !isGameScore(set.away)) return false
  const winner = Math.max(set.home, set.away)
  const loser = Math.min(set.home, set.away)
  if (format.tieBreak && format.advantage) {
    return (
      (winner === format.games && loser <= format.games - 2) ||
      (winner === format.games + 1 && (loser === format.games - 1 || loser === format.games))
    )
  }
  return winner === format.games && loser <= format.games - 1
}

export interface ScoreFormConfig {
  setOptions: number[]
  maxGames: number
}

export function scoreFormConfig(format: ProfileFormat): ScoreFormConfig {
  const needed = Math.ceil(format.sets / 2)
  const setOptions =
    format.sets === 1 ? [1] : Array.from({ length: format.sets - needed + 1 }, (_, index) => needed + index)
  return { setOptions, maxGames: format.games + (format.tieBreak && format.advantage ? 1 : 0) }
}

export function validateScore(format: ProfileFormat, sets: readonly ScoreSet[]): ScoreValidation {
  if (!Array.isArray(sets)) return { ok: false, message: 'El marcador no es valido' }
  const needed = Math.ceil(format.sets / 2)
  if (sets.length < needed || sets.length > format.sets) return { ok: false, message: 'La cantidad de sets no es valida' }
  if (sets.some((set) => !validSet(set, format))) return { ok: false, message: 'El marcador no es valido' }

  const homeSets = sets.filter((set) => set.home > set.away).length
  const awaySets = sets.length - homeSets
  if (homeSets === awaySets) return { ok: false, message: 'El marcador debe tener un ganador' }
  if (Math.max(homeSets, awaySets) !== needed) {
    return { ok: false, message: `La serie debe tener ${needed} sets ganados` }
  }

  const winner = homeSets > awaySets ? 'home' : 'away'
  const lastSet = sets[sets.length - 1]!
  const lastWinner = lastSet.home > lastSet.away ? 'home' : 'away'
  if (lastWinner !== winner) return { ok: false, message: 'La serie termino antes del ultimo set' }

  return { ok: true, winner }
}
```

- [ ] **Step 4: Implementar scheduling de dominio**

En `src/lib/domain/scheduling.ts`: reemplazar el import de `MatchFormat` por `MatchProfile` y el campo `format: MatchFormat` por `profile: MatchProfile` en `SchedulingMatch`; en la duracion usar `match.profile === 'finals'`.

- [ ] **Step 5: Resolver el perfil en los servicios**

En `src/lib/services/matches.ts`:

```ts
import { defaultFormatConfig, parseFormatConfig, type MatchProfile, type ProfileFormat } from '@/lib/domain/format'
```

Agregar el helper temporal (se elimina en Task 6):

```ts
function matchProfile(match: Match): MatchProfile {
  return match.format === 'best-of-three' ? 'finals' : 'regular'
}

function formatFor(tournament: Tournament, match: Match): ProfileFormat {
  return parseFormatConfig(tournament.formatConfig)[matchProfile(match)]
}
```

En `recordResult`: `const validation = validateScore(formatFor(context.tournament, context.match), input.sets)`. En `recordForfeit`: `forfeitScore(formatFor(context.tournament, context.match), home.teamId!, input.forfeitTeamId)`. Cambiar la firma y el cuerpo de `forfeitScore`:

```ts
function forfeitScore(format: ProfileFormat, homeTeamId: string, loserTeamId: string): ScoreSet[] {
  const winnerSlot = loserTeamId === homeTeamId ? 'away' : 'home'
  const needed = Math.ceil(format.sets / 2)
  const sets = Array.from({ length: needed }, () => format.games)
  return sets.map((games) => (winnerSlot === 'home' ? { home: games, away: 0 } : { home: 0, away: games }))
}
```

En `moveMatch`, reemplazar la duracion por:

```ts
    const minutes = matchProfile(match) === 'finals' ? tournament.longMatchMinutes : tournament.shortMatchMinutes
```

En `MatchBoardEntry` agregar `format: ProfileFormat` y completarlo en `listTournamentMatches`:

```ts
      format: tournament ? formatFor(tournament, row.match) : defaultFormatConfig().regular,
```

En `src/lib/services/scheduling.ts`, `fixedInterval`:

```ts
  const minutes = match.profile === 'finals' ? longMinutes : shortMinutes
```

y donde se arma el `SchedulingMatch` desde la fila de DB, mapear `profile: row.match.format === 'best-of-three' ? 'finals' : 'regular'` (temporal; Task 6 lo reemplaza por `row.match.profile`).

- [ ] **Step 6: Actualizar el tablero**

En `src/components/panel/match-board.tsx`: `MatchOperations` recibe `format: ProfileFormat`; `const resultForm = scoreFormConfig(format)`; el texto de un solo set pasa a `Un set a {format.games} juegos.`; en `MatchBoard` pasar `format={entry.format}`. Importar `profileForStage` no hace falta: `entry.format` ya viene resuelto.

- [ ] **Step 7: Run tests to verify they pass**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/unit/scoring.test.ts tests/unit/scheduling.test.ts && npx tsc --noEmit`
Expected: PASS y typecheck limpio.

- [ ] **Step 8: Correr la suite de integracion afectada**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/integration/matches.test.ts tests/integration/scheduling.test.ts tests/integration/brackets.test.ts`
Expected: PASS (los tests existentes siguen usando la columna `format`; los defaults no cambian).

- [ ] **Step 9: Commit**

```bash
git add src/lib/domain/scoring.ts src/lib/domain/scheduling.ts src/lib/services/matches.ts src/lib/services/scheduling.ts src/components/panel/match-board.tsx tests/unit/scoring.test.ts tests/unit/scheduling.test.ts
git commit -m "feat: parametric score validation and form config"
```

---

### Task 4: Canchas 1-6

**Files:**
- Modify: `src/lib/services/tournaments.ts`
- Modify: `src/lib/services/settings.ts`
- Modify: `src/app/actions/tournaments.ts`
- Modify: `src/components/panel/tournament-form.tsx`
- Modify: `src/components/panel/organizer-admin.tsx`
- Test: `tests/integration/tournaments.test.ts`, `tests/integration/scheduling.test.ts`

**Interfaces:**
- Consumes: `tournamentDefaults.courtCount` (Task 2).
- Produces: `courtCount` en inputs, defaults globales, formulario y acciones; reemplaza `enabledCourtCount`.

- [ ] **Step 1: Actualizar los tests**

En `tests/integration/tournaments.test.ts` reemplazar las apariciones de `enabledCourtCount` por `courtCount` (lineas 80, 117, 119, 127, 147 y 179) y agregar:

```ts
  it('creates one to six courts and adds missing ones when the count grows', async () => {
    const one = await createTournament(makeTournamentInput({ name: 'Una cancha', courtCount: 1 }))
    expect(one.courts.filter((court) => court.enabled)).toHaveLength(1)

    const six = await createTournament(makeTournamentInput({ name: 'Seis canchas', courtCount: 6 }))
    expect(six.courts).toHaveLength(6)
    expect(six.courts.filter((court) => court.enabled)).toHaveLength(6)

    const grown = await updateTournament({ id: one.id, version: one.version, courtCount: 4 })
    expect(grown.courts).toHaveLength(4)
    expect(grown.courts.filter((court) => court.enabled)).toHaveLength(4)

    const shrunk = await updateTournament({ id: grown.id, version: grown.version, courtCount: 2 })
    expect(shrunk.courts.filter((court) => court.enabled)).toHaveLength(2)
  })

  it('rejects court counts outside one to six', async () => {
    await expect(createTournament(makeTournamentInput({ courtCount: 0 }))).rejects.toThrow(
      'El torneo debe tener entre 1 y 6 canchas habilitadas',
    )
    await expect(createTournament(makeTournamentInput({ courtCount: 7 }))).rejects.toThrow(
      'El torneo debe tener entre 1 y 6 canchas habilitadas',
    )
  })
```

En `tests/integration/scheduling.test.ts` linea 237, `enabledCourtCount: 2` → `courtCount: 2`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/integration/tournaments.test.ts`
Expected: FAIL por `courtCount` desconocido y por el mensaje viejo.

- [ ] **Step 3: Implementar el servicio**

En `src/lib/services/tournaments.ts`: renombrar `enabledCourtCount` a `courtCount` en `tournamentDefaults`, ambos inputs y `ResolvedTournamentInput` (tipo `number`). En `assertTournamentInput`:

```ts
  if (input.courtCount !== undefined && (!Number.isInteger(input.courtCount) || input.courtCount < 1 || input.courtCount > 6)) {
    throw new Error('El torneo debe tener entre 1 y 6 canchas habilitadas')
  }
```

En `assertUpdateInput`, pasar `courtCount: input.courtCount`. En `createTournament`, reemplazar el insert fijo de tres canchas por:

```ts
    const tournamentCourts = await tx
      .insert(courts)
      .values(
        Array.from({ length: resolved.courtCount }, (_, index) => ({
          id: randomUUID(),
          tournamentId: tournament.id,
          name: `Cancha ${index + 1}`,
          position: index + 1,
          covered: index < 2,
          enabled: true,
        })),
      )
      .returning()
```

En `updateTournament`, reemplazar el bloque de `enabledCourtCount` por:

```ts
    if (input.courtCount !== undefined) {
      const existingCourts = await tx.select().from(courts).where(eq(courts.tournamentId, input.id))
      const missing = Array.from({ length: input.courtCount }, (_, index) => index + 1).filter(
        (position) => !existingCourts.some((court) => court.position === position),
      )
      if (missing.length > 0) {
        await tx.insert(courts).values(
          missing.map((position) => ({
            id: randomUUID(),
            tournamentId: input.id,
            name: `Cancha ${position}`,
            position,
            covered: position <= 2,
            enabled: true,
          })),
        )
      }
      await tx.update(courts).set({ enabled: false }).where(eq(courts.tournamentId, input.id))
      await tx
        .update(courts)
        .set({ enabled: true })
        .where(and(eq(courts.tournamentId, input.id), lte(courts.position, input.courtCount)))
      if (updated.state === 'in_progress') {
        await replanPendingMatches(input.id, new Date(), tx)
      }
    }
```

En `src/lib/services/settings.ts`: agregar `courtCount: number` a `GlobalSettings`, devolver `value.courtCount ?? tournamentDefaults.courtCount` en `getGlobalSettings`, y en `saveGlobalSettings` validar `if (!Number.isInteger(input.courtCount) || input.courtCount < 1 || input.courtCount > 6) throw new Error('El torneo debe tener entre 1 y 6 canchas habilitadas')` e incluirlo en el objeto persistido.

- [ ] **Step 4: Actualizar acciones y formularios**

En `src/app/actions/tournaments.ts`, reemplazar `courtCount(formData): 2 | 3` por:

```ts
function courtCountValue(formData: FormData): number | undefined {
  const raw = value(formData, 'courtCount')
  return raw ? Number(raw) : undefined
}
```

y usar `courtCount: courtCountValue(formData)` en `tournamentInput` y `updateInput`.

En `src/components/panel/tournament-form.tsx`, reemplazar el fieldset de radios por:

```tsx
      <label>
        Canchas habilitadas
        <input name="courtCount" type="number" min="1" max="6" required defaultValue={tournament?.courts.filter((court) => court.enabled).length ?? defaults?.courtCount ?? 3} />
      </label>
```

En `src/components/panel/organizer-admin.tsx`, agregar al formulario de ajustes:

```tsx
        <label>
          Canchas habilitadas
          <input name="courtCount" type="number" min="1" max="6" defaultValue={settings.courtCount} required />
        </label>
```

y ampliar el tipo de `settings` con `courtCount: number`.

En `src/app/actions/organizers.ts`, `saveSettingsAction` agrega `courtCount: Number(value(formData, 'courtCount'))`.

- [ ] **Step 5: Run tests and typecheck**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/integration/tournaments.test.ts tests/integration/scheduling.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/tournaments.ts src/lib/services/settings.ts src/app/actions/tournaments.ts src/app/actions/organizers.ts src/components/panel/tournament-form.tsx src/components/panel/organizer-admin.tsx tests/integration/tournaments.test.ts tests/integration/scheduling.test.ts
git commit -m "feat: parameterize enabled court count from one to six"
```

---

### Task 5: UI del formato

**Files:**
- Modify: `src/components/panel/tournament-form.tsx`
- Modify: `src/components/panel/organizer-admin.tsx`
- Modify: `src/app/actions/tournaments.ts`
- Modify: `src/app/actions/organizers.ts`
- Modify: `src/app/(panel)/tournaments/[tournamentId]/page.tsx`
- Modify: `src/lib/ui/labels.ts`
- Test: `tests/integration/tournaments.test.ts`

**Interfaces:**
- Consumes: `FormatConfig`, `ProfileFormat`, `formatLabel`, `formatExample`, `parseFormatConfig` (Task 1); `GlobalSettings.formatConfig` (Task 2).
- Produces: campos `regularGames|regularSets|regularTieBreak|regularAdvantage|finalsGames|finalsSets|finalsTieBreak|finalsAdvantage`; `TournamentDefaultValues.formatConfig`.

- [ ] **Step 1: Agregar un test de accion con formato**

En `tests/integration/tournaments.test.ts`:

```ts
  it('parses the format fields from the tournament form', async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: 'organizer-id', username: 'organizador1', role: 'organizer' })
    const formData = new FormData()
    formData.set('name', 'Formateado')
    formData.set('date', '2026-10-03')
    formData.set('timezone', 'America/Argentina/Buenos_Aires')
    formData.set('startsAt', '09:00')
    formData.set('endsAt', '21:00')
    formData.set('courtCount', '3')
    formData.set('regularGames', '6')
    formData.set('regularSets', '1')
    formData.set('finalsGames', '6')
    formData.set('finalsSets', '3')
    formData.set('finalsTieBreak', 'on')
    formData.set('finalsAdvantage', 'con-ventaja')

    await createTournamentAction({}, formData)
    const [created] = await db.select().from(tournaments).where(eq(tournaments.name, 'Formateado'))
    expect(created!.formatConfig.regular).toEqual({ games: 6, sets: 1, tieBreak: false, advantage: false })
    expect(created!.formatConfig.finals).toEqual({ games: 6, sets: 3, tieBreak: true, advantage: true })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/integration/tournaments.test.ts`
Expected: FAIL: `formatConfig.regular` queda con los defaults (9/1/true/false).

- [ ] **Step 3: Parsear el formato en las acciones**

En `src/app/actions/format-form.ts` (nuevo, sin `'use server'`):

```ts
import { parseFormatConfig } from '@/lib/domain/format'

function value(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim()
}

export function profileFrom(formData: FormData, prefix: 'regular' | 'finals') {
  return {
    games: Number(value(formData, `${prefix}Games`)),
    sets: Number(value(formData, `${prefix}Sets`)),
    tieBreak: formData.get(`${prefix}TieBreak`) !== null,
    advantage: value(formData, `${prefix}Advantage`) === 'con-ventaja',
  }
}

export function formatConfigFrom(formData: FormData) {
  if (!formData.has('regularGames') || !formData.has('finalsGames')) return undefined
  return parseFormatConfig({ regular: profileFrom(formData, 'regular'), finals: profileFrom(formData, 'finals') })
}
```

En `src/app/actions/tournaments.ts`, importar `formatConfigFrom` y usarlo en `tournamentInput` y `updateInput`. En `src/app/actions/organizers.ts`, importar `formatConfigFrom` y `defaultFormatConfig` y usar `formatConfig: formatConfigFrom(formData) ?? defaultFormatConfig()` en `saveSettingsAction`.

- [ ] **Step 4: Agregar los campos al formulario**

En `src/components/panel/tournament-form.tsx`, ampliar `TournamentDefaultValues` con `courtCount: number` y `formatConfig: FormatConfig`, e importar `formatExample`, `type FormatConfig`, `type ProfileFormat` y `useState`.

Agregar el subcomponente exportado al final del archivo:

```tsx
export function ProfileFields({
  profile,
  label,
  format,
  locked,
}: {
  profile: 'regular' | 'finals'
  label: string
  format: ProfileFormat
  locked: boolean
}) {
  const [games, setGames] = useState(format.games)
  const [sets, setSets] = useState(format.sets)
  const [tieBreak, setTieBreak] = useState(format.tieBreak)
  const [advantage, setAdvantage] = useState(format.advantage)
  const example = formatExample({ games, sets, tieBreak, advantage })

  return (
    <fieldset className="fieldset--flat">
      <legend>{label}</legend>
      <div className="field-row">
        <label>
          Juegos por set
          <input
            name={`${profile}Games`}
            type="number"
            min="4"
            max="9"
            required
            value={games}
            disabled={locked}
            onChange={(event) => setGames(Number(event.target.value))}
          />
        </label>
        <label>
          Al mejor de
          <select name={`${profile}Sets`} value={sets} disabled={locked} onChange={(event) => setSets(Number(event.target.value))}>
            <option value={1}>1 set</option>
            <option value={3}>3 sets</option>
            <option value={5}>5 sets</option>
          </select>
        </label>
      </div>
      <label>
        <input
          type="checkbox"
          name={`${profile}TieBreak`}
          checked={tieBreak}
          disabled={locked}
          onChange={(event) => setTieBreak(event.target.checked)}
        />
        Tie-break
      </label>
      {tieBreak ? (
        <label>
          Cierre del set
          <select
            name={`${profile}Advantage`}
            value={advantage ? 'con-ventaja' : 'sin-ventaja'}
            disabled={locked}
            onChange={(event) => setAdvantage(event.target.value === 'con-ventaja')}
          >
            <option value="sin-ventaja">
              Tie-break en {games - 1}-{games - 1} (sin ventaja)
            </option>
            <option value="con-ventaja">
              Tie-break en {games}-{games} (con ventaja: {games + 1}-{games - 1} o {games + 1}-{games})
            </option>
          </select>
        </label>
      ) : null}
      <p className="meta">Ejemplo: {example}</p>
    </fieldset>
  )
}
```

Y dentro del `<form>`, antes del boton de guardar:

```tsx
      <fieldset className="fieldset--flat">
        <legend>Formato de partidos</legend>
        <div className="card-grid">
          <ProfileFields
            profile="regular"
            label="Regulares"
            format={tournament?.formatConfig.regular ?? defaults?.formatConfig.regular ?? DEFAULT_FORMAT_CONFIG.regular}
            locked={locked}
          />
          <ProfileFields
            profile="finals"
            label="Finales"
            format={tournament?.formatConfig.finals ?? defaults?.formatConfig.finals ?? DEFAULT_FORMAT_CONFIG.finals}
            locked={locked}
          />
        </div>
      </fieldset>
```

Importar `DEFAULT_FORMAT_CONFIG` desde `@/lib/domain/format`.

En `src/components/panel/organizer-admin.tsx`, ampliar el tipo de `settings` con `formatConfig: FormatConfig` y agregar el mismo bloque `ProfileFields` (importado desde `@/components/panel/tournament-form`) dentro del formulario de ajustes.

- [ ] **Step 5: Linea de formato en el detalle y limpieza**

En `src/app/(panel)/tournaments/[tournamentId]/page.tsx`, despues del parrafo de estado:

```tsx
      <p className="meta">
        Formato: {formatLabel(tournament.formatConfig.regular)} | Finales: {formatLabel(tournament.formatConfig.finals)}
      </p>
```

En `src/lib/ui/labels.ts`, borrar `FORMAT_LABELS` y el import de `MatchFormat`.

- [ ] **Step 6: Run tests, typecheck y lint**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npx vitest run tests/integration/tournaments.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/panel/tournament-form.tsx src/components/panel/organizer-admin.tsx src/app/actions/tournaments.ts src/app/actions/organizers.ts "src/app/(panel)/tournaments/[tournamentId]/page.tsx" src/lib/ui/labels.ts tests/integration/tournaments.test.ts
git commit -m "feat: tournament and settings UI for match format"
```

---

### Task 6: Limpieza de esquema (`matches.profile`)

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/<timestamp>_match_profile.sql`
- Modify: `src/lib/domain/types.ts`, `src/lib/domain/bracket.ts`
- Modify: `src/lib/services/brackets.ts`, `matches.ts`, `scheduling.ts`, `public.ts`
- Test: `tests/integration/{schema,matches,brackets,teams}.test.ts`

**Interfaces:**
- Consumes: `MatchProfile`, `profileForStage` (Task 1).
- Produces: `matches.profile`; `BracketMatch.profile`; se elimina `MatchFormat` y `matchFormatEnum`.

- [ ] **Step 1: Cambiar el esquema**

En `src/lib/db/schema.ts`: borrar `matchFormatEnum` y agregar:

```ts
export const matchProfileEnum = pgEnum('match_profile', ['regular', 'finals'])
```

En `matches`, reemplazar `format: matchFormatEnum('format').notNull()` por:

```ts
    profile: matchProfileEnum('profile').notNull(),
```

- [ ] **Step 2: Generar y editar la migracion**

Run: `npm run db:generate`
Expected: SQL con `CREATE TYPE "public"."match_profile"`, `ALTER TABLE "matches" ADD COLUMN "profile"`, `DROP COLUMN "format"`, `DROP TYPE "public"."match_format"`. Editar el SQL generado para insertar el backfill entre el add y el drop:

```sql
UPDATE "matches" SET "profile" = CASE WHEN "format" = 'best-of-three' THEN 'finals'::"match_profile" ELSE 'regular'::"match_profile" END;
```

Ajustar el `ADD COLUMN` a nullable si drizzle lo genero NOT NULL, y agregar `ALTER TABLE "matches" ALTER COLUMN "profile" SET NOT NULL;` despues del backfill. Aplicar:

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npm run db:migrate`
Expected: migracion aplicada sin errores.

- [ ] **Step 3: Actualizar el dominio**

En `src/lib/domain/types.ts`, borrar `export type MatchFormat = ...`. En `src/lib/domain/bracket.ts`: importar `MatchProfile, profileForStage` de `@/lib/domain/format`; `BracketMatch.profile: MatchProfile`; borrar `matchFormat` local; usar `profile: profileForStage(stage)` en `roundMatch`; quitar `MatchFormat` del import de types.

- [ ] **Step 4: Actualizar servicios**

- `src/lib/services/brackets.ts`: `format: match.format` → `profile: match.profile`.
- `src/lib/services/matches.ts`: borrar `matchProfile()` y `formatFor()` temporales; usar `context.tournament.formatConfig[context.match.profile]` y `tournament.formatConfig[row.match.profile]`; `forfeitScore` recibe `context.tournament.formatConfig[context.match.profile]`.
- `src/lib/services/scheduling.ts`: `fixedInterval` usa `match.profile === 'finals'`; el mapeo a `SchedulingMatch` pasa `profile: row.match.profile`.
- `src/lib/services/public.ts`: quitar `format` de `PublicMatch` y del objeto que se construye.

- [ ] **Step 5: Actualizar tests**

- `tests/integration/brackets.test.ts`: `format: 'best-of-three'` → `profile: 'finals'`; `format: 'one-set-nine'` → `profile: 'regular'`.
- `tests/integration/teams.test.ts`: los dos `format: 'best-of-three'` → `profile: 'finals'`.
- `tests/integration/matches.test.ts`: `row.format === 'one-set-nine'` → `row.profile === 'regular'`; en `play()`, los marcadores del perfil regular siguen siendo `9-7` y los de finales `6-4` (sin cambios).
- `tests/integration/schema.test.ts`: agregar

```ts
  it('stores the match profile and no longer has a match format column', async () => {
    const result = await db.execute<{ column_name: string }>(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'matches'
    `)
    const columns = result.rows.map((column) => column.column_name)
    expect(columns).toContain('profile')
    expect(columns).not.toContain('format')
  })
```

- [ ] **Step 6: Buscar referencias restantes**

Run: `grep -rn "MatchFormat\|matchFormatEnum\|one-set-nine\|best-of-three" src/ tests/`
Expected: sin resultados (o solo textos historicos en docs/).

- [ ] **Step 7: Run the full unit and integration suite**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npm test`
Expected: PASS (130+ tests).

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts drizzle src/lib/domain src/lib/services tests/integration
git commit -m "refactor: store match profile instead of format enum"
```

---

### Task 7: E2E del formato custom y verificacion final

**Files:**
- Create: `tests/e2e/parametrizacion.spec.ts`
- Modify (si hace falta): `tests/e2e/full-tournament.spec.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: cobertura E2E del camino configurable.

- [ ] **Step 1: Escribir el spec E2E**

```ts
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
```

Los dos perfiles quedan en 1 set a 6 con tie-break apagado, asi el partido de "Final de ganadores" (perfil finales) tambien usa el formato custom y la asercion del formulario de resultado vale para ese partido.

- [ ] **Step 2: Correr el spec nuevo**

Run: `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test SESSION_SECRET=test-secret npx playwright test tests/e2e/parametrizacion.spec.ts`
Expected: PASS.

- [ ] **Step 3: Verificacion completa**

Run en este orden:

```bash
npx tsc --noEmit
npm run lint
DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test npm test
DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush_test SESSION_SECRET=test-secret npm run test:e2e
npm run build
```

Expected: todo en verde (unit + integracion 130+, E2E 6 specs, build OK).

- [ ] **Step 4: Avisar sobre la migracion de la base real**

La app en desarrollo corre contra `padel_rush`; para que el cambio funcione ahi hay que correr `npm run db:migrate` (sin `DATABASE_URL` de test). **Pedir confirmacion al usuario antes de aplicarla** y ofrecer `npm run backup` primero.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/parametrizacion.spec.ts
git commit -m "test: cover custom tournament format end to end"
```

---

## Self-Review

- Cobertura del spec: modulo de dominio (Task 1), persistencia y defaults (Task 2), motor y callers (Task 3), canchas 1-6 (Task 4), UI y etiquetas (Task 5), `matches.profile` y limpieza del enum (Task 6), E2E y verificacion (Task 7). Los criterios de aceptacion 1-4 quedan cubiertos por los tests de Task 2 (defaults y bloqueo), Task 3 (matriz), Task 4 (canchas) y Task 7 (E2E custom).
- Sin placeholders: cada paso trae el codigo o el comando exacto.
- Consistencia de tipos: `ProfileFormat`/`FormatConfig`/`MatchProfile` se definen en Task 1 y se usan con esos nombres en todas las tareas; `courtCount` reemplaza a `enabledCourtCount` por completo en Task 4 (servicio, ajustes, acciones y formularios); `parseFormatConfig` es el unico validador.
- Riesgo conocido: Task 3 deja un mapeo temporal `format -> profile` que Task 6 elimina; el plan lo marca explicitamente.
