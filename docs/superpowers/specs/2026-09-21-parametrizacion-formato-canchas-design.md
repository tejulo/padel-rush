# Parametrizacion de formato y canchas

## Objetivo

Hoy el formato de cada partido esta fijo en el codigo: los partidos previos a las finales se juegan a un set de 9 juegos con tie-break en 8-8, las finales al mejor de tres sets de 6 con ventaja y tie-break en 6-6, y el torneo admite exactamente 2 o 3 canchas habilitadas. Esta funcionalidad convierte esas reglas en configuracion por torneo (con valores por defecto globales) sin cambiar el comportamiento de los torneos existentes: los defaults reproducen exactamente las reglas actuales.

## Alcance

- Cantidad de canchas habilitadas: 1 a 6 (hoy 2 o 3).
- Formato de partidos regulares y de finales, cada uno con: juegos por set (`games`), sets por partido (`sets`, al mejor de), tie-break (si/no) y ventaja (si/no).
- Los valores se copian de Ajustes globales al crear el torneo y quedan editables solo mientras el torneo esta en borrador.
- Se mantiene la distincion regulares/finales por etapa (misma clasificacion que hoy: final de ganadores, final de perdedores, gran final y reinicio de gran final usan el perfil "finales").

Fuera de alcance:

- Puntos del tie-break (fijo 7 puntos, diferencia de 2).
- Punto de oro (siempre, no se registra).
- Overrides por partido.
- Estructura de competencia (cantidad de partidos, liguilla, eliminacion simple).
- Nombres de canchas y el flag `covered` (vestigial; se mantiene como esta).

## Modelo de datos

### Tipos de dominio (nuevo `src/lib/domain/format.ts`)

```ts
export type MatchProfile = 'regular' | 'finals'

export interface ProfileFormat {
  games: number // juegos para ganar un set
  sets: number // al mejor de: 1, 3 o 5
  tieBreak: boolean // true: en el empate decisivo se juega tie-break
  advantage: boolean // true: no cierra por 1 de diferencia (requiere tieBreak)
}

export interface FormatConfig {
  regular: ProfileFormat
  finals: ProfileFormat
}
```

Defaults (= reglas actuales):

```ts
export const DEFAULT_FORMAT_CONFIG: FormatConfig = {
  regular: { games: 9, sets: 1, tieBreak: true, advantage: false },
  finals: { games: 6, sets: 3, tieBreak: true, advantage: true },
}
```

Rangos: `games` entero 4-9; `sets` en {1, 3, 5}; `advantage` se ignora cuando `tieBreak` es false (se normaliza a false al guardar).

Funciones del modulo:

- `parseFormatConfig(value: unknown): FormatConfig`: valida rangos y normaliza; usado por acciones, servicios y lecturas de DB.
- `defaultFormatConfig(): FormatConfig`: copia de los defaults.
- `formatLabel(profile: ProfileFormat): string`: etiqueta legible.
- `profileForStage(stage: MatchStage): MatchProfile`: regulares vs finales (mueve y renombra `matchFormat` de `bracket.ts`).

### Esquema

- `tournaments.format_config jsonb not null` con default `DEFAULT_FORMAT_CONFIG`, tipado `$type<FormatConfig>()` (el repo ya usa jsonb para `app_settings.value`). El config es una unidad que se copia y guarda entera; la validacion de rangos vive en `parseFormatConfig`, no en CHECKs de SQL.
- `app_settings` (key `'defaults'`): el objeto `value` suma `courtCount` y `formatConfig`.
- `matches.profile` (enum `match_profile` con `('regular','finals')`) reemplaza la columna `format` (enum `match_format`), que se elimina junto con `MatchFormat` en `types.ts`. El marcador valido se resuelve contra la config del torneo segun el perfil.
- Los servicios exponen la config ya resuelta para no repetir la resolucion en la UI: `MatchBoardEntry` incluye `format: ProfileFormat` (el perfil del partido resuelto contra el torneo) y el tablero llama `scoreFormConfig(entry.format)`.

Migracion:

1. Agregar `tournaments.format_config` con default.
2. Crear enum `match_profile` y agregar columna `matches.profile` nullable.
3. Backfill: `one-set-nine` -> `regular`; `best-of-three` -> `finals`.
4. Dejar `profile` NOT NULL y eliminar la columna `format` y el tipo `match_format`.

## Reglas de puntuacion

Sea `T = games` y `needed = ceil(sets / 2)`.

### Set valido

Con `tieBreak && advantage` (tenis):

- Normal: `winner === T && loser <= T - 2` -> 6-0 ... 6-4.
- Ventaja: `winner === T + 1 && loser === T - 1` -> 7-5.
- Tie-break: `winner === T + 1 && loser === T` -> 7-6.

En cualquier otro caso (tie-break apagado, o tie-break sin ventaja):

- `winner === T && loser <= T - 1` -> 9-0 ... 9-8 con T=9; 6-0 ... 6-5 con T=6.

Notas:

- El registro no distingue como se jugo el set: 9-8 es el resultado del tie-break en 8-8 (encendido, sin ventaja) o del cierre directo al llegar (apagado). El flag `tieBreak` afecta como se juega y la etiqueta, no el conjunto de marcadores validos cuando no hay ventaja.
- `advantage` solo aplica con `tieBreak` encendido; apagado, el set cierra al llegar a T aunque sea por 1.

### Partido (mejor de `sets`)

- Sets jugados: entre `needed` y `sets`.
- El ganador debe tener exactamente `needed` sets y ganar el ultimo set jugado (rechaza sets muertos: 2-0 y un tercero, 3-0 y un cuarto, etc.).
- `sets = 1`: exactamente 1 set.

### Forfeit (ausencia o retiro)

- `needed` sets con `T-0` para el rival: regular 9-0 (1 set); finales 6-0, 6-0 (2 sets); al mejor de 5 -> 6-0 x3.

### Formulario de resultado

`scoreFormConfig(profileFormat)`:

- `setOptions`: `sets === 1 ? [1] : [needed ... sets]` (mejor de 3 -> [2,3]; mejor de 5 -> [3,4,5]). El selector de sets solo se muestra si hay mas de una opcion.
- `maxGames`: `T + (tieBreak && advantage ? 1 : 0)` (hoy: 9 y 7).

### Etiqueta de formato

`formatLabel(profile)` se arma con el config, no con textos fijos:

- Encabezado: `sets === 1` -> "Un set a {games} juegos"; `sets > 1` -> "Al mejor de {sets} sets a {games} juegos".
- Sufijo: `tieBreak` apagado -> "cierre directo"; sin ventaja -> "tie-break en {T-1}-{T-1}"; con ventaja -> "con ventaja y tie-break en {T}-{T}".
- Con los defaults: "Un set a 9 juegos, tie-break en 8-8" y "Al mejor de 3 sets a 6 juegos, con ventaja y tie-break en 6-6".

Se muestra en el detalle del torneo (panel). Se elimina `FORMAT_LABELS` de `src/lib/ui/labels.ts` (quedo sin uso).

### Duracion y programacion

El perfil define el bloque: `regular` -> `shortMatchMinutes`, `finals` -> `longMatchMinutes` (igual que hoy). `scheduling.ts` y `matches.ts` comparan por `profile`.

## Canchas

- `courtCount` entero 1-6 (default 3); reemplaza `enabledCourtCount` (2|3) en defaults, formulario, validaciones y servicio.
- Alta: crea las filas `Cancha 1..courtCount` (position 1..N, `enabled=true`; `covered=true` solo para 1 y 2, como hoy).
- Edicion: asegura que existan las filas 1..N (crea las faltantes), habilita 1..N y deshabilita N+1..6 si existen. Si el torneo esta en juego, replanifica los partidos pendientes (comportamiento actual).
- Las canchas siguen editables despues de iniciar el torneo (spec original); el formato, no.

## UI

Formulario de torneo (`tournament-form.tsx`):

- "Canchas habilitadas": input numerico 1-6 (default 3). Sigue editable en cualquier estado (dispara replanificacion en juego).
- "Formato de partidos": dos columnas (Regulares / Finales) con: Juegos por set (4-9), Al mejor de (1/3/5), checkbox Tie-break y, si esta activo, select "Cierre":
  - "Tie-break en {T-1}-{T-1} (sin ventaja)" -> `advantage=false`.
  - "Tie-break en {T}-{T} (con ventaja: {T+1}-{T-1} o {T+1}-{T})" -> `advantage=true`.
  - Linea de ejemplo en vivo: "Ejemplo: 6-4, 7-5 o 7-6".
- Los campos de formato se deshabilitan cuando el torneo no esta en borrador (`locked`), igual que fecha y duraciones. Ademas, `updateTournament` rechaza cambios de formato si el torneo no esta en borrador (guarda del lado servidor; la UI sola no alcanza porque un resultado guardado no se puede reinterpretar con reglas nuevas).
- Nombres planos para el FormData: `courtCount`, `regularGames`, `regularSets`, `regularTieBreak`, `regularAdvantage`, `finalsGames`, `finalsSets`, `finalsTieBreak`, `finalsAdvantage`.
- Checkboxes: `tieBreak` ausente = false; `advantage` con tie-break apagado se normaliza a false.

Ajustes globales (admin, `organizer-admin.tsx`): los mismos campos como defaults.

Vista publica: sin cambios visuales; se quita el `format` no usado del tipo publico.

## Validaciones y errores

- `courtCount` fuera de 1-6: "El torneo debe tener entre 1 y 6 canchas habilitadas".
- `games` fuera de 4-9: "Los juegos por set deben estar entre 4 y 9".
- `sets` fuera de {1,3,5}: "La cantidad de sets debe ser 1, 3 o 5".
- `format_config` invalido en DB o servicio: error de configuracion; no se inventan valores.
- Marcador invalido: se mantienen los mensajes actuales ("La cantidad de sets no es valida", "El marcador no es valido") y los de serie se generalizan a `needed`: "La serie debe tener {needed} sets ganados" y "La serie termino antes del ultimo set".

## Compatibilidad

- Los torneos existentes reciben `format_config` default = reglas actuales; sus partidos jugados y pendientes siguen validando igual.
- Los partidos existentes migran `format` -> `profile` sin cambio de comportamiento (`one-set-nine` -> `regular` con 9/1/tb/advantage=false; `best-of-three` -> `finals` con 6/3/tb/advantage=true).
- Los defaults globales existentes (`app_settings.value` sin `formatConfig` ni `courtCount`) se completan al leer, como ya hace `getGlobalSettings`.

## Pruebas

- Unit (`scoring` / `format`): matriz por convencion y T (9-0...9-8; 6-0...6-4, 7-5, 7-6; 6-0...6-5 sin tie-break; rechazos: 10-8 sin ventaja, 6-5 con ventaja, 9-9, set muerto, mejor de 5 con 3-0 y cuarto set, mejor de 1 con 2 sets); `scoreFormConfig` (opciones y max); forfeits; `formatLabel`; `parseFormatConfig` (rangos y normalizacion de advantage).
- Integracion: crear torneo con formato custom y verificar que los partidos generados llevan el perfil correcto y que la validacion usa esa config; forfeit con la config; `courtCount` 1 y 6 (alta y edicion con replanificacion en juego); bloqueo del formato post-inicio; `profileForStage`.
- E2E: el flujo actual sigue verde (defaults identicos). Sumar un caso que cree un torneo con formato custom (por ejemplo ambos perfiles a 1 set de 6 con tie-break apagado) y cargue un resultado valido (6-4) y uno invalido (7-6).

## Impacto en archivos

- Dominio: `format.ts` (nuevo), `scoring.ts`, `bracket.ts`, `scheduling.ts`, `types.ts`.
- DB: `schema.ts` mas una migracion nueva.
- Servicios: `tournaments.ts` (defaults, validaciones 1-6, alta y edicion de canchas, persistencia del formato), `settings.ts`, `matches.ts` (resolucion del perfil, validacion, forfeit, duracion), `brackets.ts`, `public.ts` (quitar `format`).
- Acciones: `tournaments.ts`, `organizers.ts` (parseo y validacion de los campos nuevos).
- UI: `tournament-form.tsx`, `organizer-admin.tsx`, `match-board.tsx`, `labels.ts` (borrar `FORMAT_LABELS`), detalle del torneo (linea de formato).
- Tests: `unit/scoring.test.ts`, `unit/scheduling.test.ts`, `unit/bracket.test.ts`, `integration/brackets|teams|matches|tournaments|schema.test.ts`, `e2e/full-tournament.spec.ts` mas un caso custom.

## Criterios de aceptacion

1. Crear un torneo sin tocar nada reproduce el comportamiento actual (validaciones 9-8 y 6-4/7-5/7-6, forfeits 9-0 y 6-0 6-0, duraciones corta y larga, 3 canchas).
2. Un torneo nuevo se configura con canchas 1-6 y formatos distintos por perfil, y el tablero acepta o rechaza marcadores segun esa config.
3. El formato queda bloqueado al iniciar; las canchas siguen editables con replanificacion.
4. Un torneo existente sigue operando sin cambios.
