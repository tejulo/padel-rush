# Padel Rush Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, responsive web application to run one-day padel tournaments with balanced teams, double-elimination brackets, automatic scheduling, authenticated operations, and public read-only views.

**Architecture:** Next.js App Router provides the operator and public pages in one deployable application. Pure TypeScript modules contain pairing, bracket, scoring, and scheduling rules; server actions call focused persistence services that use Drizzle transactions against PostgreSQL. Railway hosts the web service and PostgreSQL; Docker Compose is only for local development.

**Tech Stack:** Next.js 16.1.6, TypeScript, React 19, PostgreSQL, Drizzle ORM and Kit, node-postgres, Argon2id, Vitest 4.1.6, Playwright 1.61.0, Docker Compose, Railway.

**Spec:** `docs/superpowers/specs/2026-09-13-padel-relampago-design.md`

## Global Constraints

- Use Next.js 16 App Router, Server Components, Server Actions, and TypeScript; do not create a separate API service.
- Use PostgreSQL on Railway and Drizzle migrations; Docker Compose runs the local application and database only.
- Keep modules narrow, use descriptive Spanish UI copy, and add comments only when an invariant is not clear from the code.
- Use no player accounts, email, payments, history product, WebSockets, chat, or offline mode.
- Authenticate only with a 3-32 character alphanumeric username and a password of at least 12 characters.
- Hash passwords with Argon2id; store revocable, hashed session tokens in PostgreSQL and send only secure `HttpOnly` cookies.
- Store and render names only for the authenticated operator and public tournament page; public links are random, revocable tokens.
- A tournament owns two or three enabled courts, separate short and long durations, a rest minimum, and an end-time warning.
- Enforce every sports rule in server-side domain code for all roles, including the administrator.
- All non-final matches are one set to nine games, tie-break at 8-8, and golden point at deuce. Winners final, losers final, grand final, and reset are best of three six-game sets with tie-break at 6-6 and golden point.
- Run unit tests with Vitest and browser flows with Playwright. Use accessible role/name locators in browser tests.

---

## File Structure

```text
src/
  app/
    (auth)/login/page.tsx
    (panel)/layout.tsx
    (panel)/page.tsx
    (panel)/admin/organizers/page.tsx
    (panel)/tournaments/new/page.tsx
    (panel)/tournaments/[tournamentId]/page.tsx
    (panel)/tournaments/[tournamentId]/participants/page.tsx
    (panel)/tournaments/[tournamentId]/teams/page.tsx
    (panel)/tournaments/[tournamentId]/matches/page.tsx
    public/[publicToken]/page.tsx
    actions/auth.ts
    actions/organizers.ts
    actions/tournaments.ts
    actions/participants.ts
    actions/teams.ts
    actions/matches.ts
    layout.tsx
    page.tsx
    globals.css
  components/
    auth/login-form.tsx
    panel/tournament-form.tsx
    panel/participant-form.tsx
    panel/team-proposal.tsx
    panel/match-board.tsx
    public/tournament-view.tsx
    public/refresh-button.tsx
  lib/
    auth/password.ts
    auth/session.ts
    auth/guards.ts
    auth/rate-limit.ts
    db/client.ts
    db/schema.ts
    db/migrate.ts
    domain/types.ts
    domain/validation.ts
    domain/pairing.ts
    domain/scoring.ts
    domain/bracket.ts
    domain/scheduling.ts
    services/users.ts
    services/tournaments.ts
    services/participants.ts
    services/teams.ts
    services/brackets.ts
    services/matches.ts
    services/public.ts
    test/factories.ts
    test/database.ts
drizzle/
tests/
  unit/*.test.ts
  integration/*.test.ts
  e2e/*.spec.ts
docker-compose.yml
Dockerfile
drizzle.config.ts
vitest.config.ts
playwright.config.ts
```

## Task 1: Bootstrap the Application and Test Harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.gitignore`, `.env.example`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `vitest.config.ts`, `playwright.config.ts`, `tests/unit/smoke.test.ts`
- Create: `Dockerfile`, `docker-compose.yml`

**Interfaces:**
- Produces npm scripts: `dev`, `build`, `start`, `lint`, `test`, `test:coverage`, `test:e2e`, `db:generate`, and `db:migrate`.
- Produces `GET /` with a redirect to `/login` or the authenticated dashboard in later tasks.

- [ ] **Step 1: Write the initial smoke test**

```ts
// tests/unit/smoke.test.ts
import { describe, expect, it } from 'vitest'

describe('test harness', () => {
  it('runs TypeScript tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 2: Install the minimal runtime and test dependencies**

```bash
npm init -y
npm install next@16.1.6 react react-dom drizzle-orm pg argon2
npm install -D typescript tsx @types/node @types/react @types/react-dom @types/pg drizzle-kit vitest@4.1.6 @vitest/coverage-v8 @playwright/test@1.61.0 eslint eslint-config-next
```

- [ ] **Step 3: Add configuration and scripts**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/lib/db/migrate.ts"
  }
}
```

Configure Vitest with `environment: 'node'`, `include: ['tests/**/*.test.ts']`, and v8 coverage. Configure Playwright with Chromium, `baseURL: 'http://127.0.0.1:3000'`, and a `webServer` that runs `npm run dev` outside CI and `npm run start` in CI.

- [ ] **Step 4: Add the root layout, landing redirect, local Docker services, and environment template**

`docker-compose.yml` must define `app` and `postgres` services; bind PostgreSQL only to `127.0.0.1:5432`, use a named volume, and expose the app on port 3000. `.env.example` must include `DATABASE_URL`, `SESSION_SECRET`, `BOOTSTRAP_ADMIN_USERNAME`, and `BOOTSTRAP_ADMIN_PASSWORD`, without values.

- [ ] **Step 5: Run the baseline checks**

Run: `npm run test && npm run lint && npm run build`

Expected: all commands exit with code 0.

- [ ] **Step 6: Commit the bootstrap**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts eslint.config.mjs .gitignore .env.example src/app vitest.config.ts playwright.config.ts tests/unit/smoke.test.ts Dockerfile docker-compose.yml
git commit -m "chore: bootstrap Next.js application"
```

## Task 2: Create the PostgreSQL Schema and Migration Workflow

**Files:**
- Create: `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `src/lib/db/migrate.ts`, `src/lib/test/database.ts`, `src/lib/test/factories.ts`, `drizzle.config.ts`
- Create: `tests/integration/schema.test.ts`
- Create: `drizzle/0000_initial.sql` through Drizzle Kit

**Interfaces:**
- Produces `db`, a typed Drizzle client created from `DATABASE_URL`.
- Produces tables `users`, `sessions`, `loginAttempts`, `tournaments`, `courts`, `participants`, `registrations`, `teams`, `teamMembers`, `categories`, `matches`, and `matchSlots`.
- Produces `resetDatabase(): Promise<void>` for integration tests and `makeTournamentInput()` test data.

- [ ] **Step 1: Write the schema constraint tests**

```ts
// tests/integration/schema.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { resetDatabase } from '@/lib/test/database'
import { createTournament } from '@/lib/services/tournaments'

afterEach(resetDatabase)

describe('database schema', () => {
  it('creates two covered courts and one uncovered court for a tournament', async () => {
    await db.insert(users).values({
      id: 'organizer-id',
      username: 'organizador1',
      passwordHash: 'test-hash',
      role: 'organizer',
      active: true,
    })
    const tournament = await createTournament({
      name: 'Sabado de padel',
      date: '2026-10-03',
      timezone: 'America/Argentina/Buenos_Aires',
      startsAt: '09:00',
      endsAt: '21:00',
      shortMatchMinutes: 40,
      longMatchMinutes: 90,
      restMinutes: 20,
      organizerId: 'organizer-id',
    })

    expect(tournament.courts).toHaveLength(3)
    expect(tournament.courts.filter((court) => court.covered)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the test to verify the missing service and schema fail**

Run: `npm run test -- tests/integration/schema.test.ts`

Expected: FAIL because `createTournament` and the database schema do not exist.

- [ ] **Step 3: Define Drizzle tables and explicit database constraints**

Use UUID string primary keys generated in application code. Add unique constraints for username, session token hash, public token, one registration per participant/category, one membership per participant/category, and one active organizer assignment per tournament. Store category, tournament, match, and user states as PostgreSQL enums. Add `version` integers to `tournaments`, `participants`, `teams`, and `matches` for optimistic concurrency.

`matches` must store `categoryId`, `stage`, `round`, `position`, `format`, `state`, court and scheduled/actual times, score JSON, winner/loser team IDs, and source references. `matchSlots` must store `matchId`, `slot` (`a` or `b`), `sourceMatchId`, and `sourceOutcome` (`winner` or `loser`) so the bracket is data, not hard-coded UI state.

- [ ] **Step 4: Add typed database setup, migration runner, test reset, and factories**

```ts
// src/lib/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
export const db = drizzle({ client: pool, schema })
```

`resetDatabase` truncates every application table with `RESTART IDENTITY CASCADE`. `makeTournamentInput` returns the values used by the test. Generate and run the first migration with `npm run db:generate && npm run db:migrate`.

- [ ] **Step 5: Run schema integration and type checks**

Run: `npm run test -- tests/integration/schema.test.ts && npm run build`

Expected: PASS and the generated migration applies to the local PostgreSQL container.

- [ ] **Step 6: Commit the persistence foundation**

```bash
git add drizzle.config.ts drizzle src/lib/db src/lib/test tests/integration/schema.test.ts
git commit -m "feat: add tournament database schema"
```

## Task 3: Implement Username Authentication, Sessions, and Authorization

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/guards.ts`, `src/lib/auth/rate-limit.ts`, `src/lib/services/users.ts`
- Create: `src/app/actions/auth.ts`, `src/app/(auth)/login/page.tsx`, `src/components/auth/login-form.tsx`, `src/app/(panel)/layout.tsx`
- Create: `tests/unit/password.test.ts`, `tests/integration/auth.test.ts`

**Interfaces:**
- Produces `validateCredentials(input): CredentialValidation`.
- Produces `hashPassword(password): Promise<string>` and `verifyPassword(hash, password): Promise<boolean>`.
- Produces `requireUser(): Promise<SessionUser>` and `requireRole(role: Role): Promise<SessionUser>`.
- Produces `signIn(username, password): Promise<SignInResult>` and `signOut(): Promise<void>`.

- [ ] **Step 1: Write credential and session tests**

```ts
// tests/unit/password.test.ts
import { expect, it } from 'vitest'
import { validateCredentials } from '@/lib/auth/password'

it('accepts an alphanumeric username and a 12-character password', () => {
  expect(validateCredentials({ username: 'organizador1', password: 'padel-seguro1' })).toEqual({ ok: true })
})

it('rejects usernames with spaces and short passwords', () => {
  expect(validateCredentials({ username: 'mal usuario', password: 'corta' }).ok).toBe(false)
})
```

```ts
// tests/integration/auth.test.ts
it('locks a username and IP after five invalid attempts', async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await signIn('organizador1', 'incorrecta', '127.0.0.1')
  }
  await expect(signIn('organizador1', 'padel-seguro1', '127.0.0.1')).resolves.toMatchObject({ ok: false, reason: 'locked' })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/password.test.ts tests/integration/auth.test.ts`

Expected: FAIL because authentication modules do not exist.

- [ ] **Step 3: Implement password, rate-limit, session, and user services**

Use `argon2.hash(password, { type: argon2.argon2id })` and `argon2.verify`. Store only SHA-256 hashes of random 32-byte session tokens, with expiration and revocation timestamps. Put the raw token in the `padel_rush_session` `HttpOnly`, `Secure`, `SameSite=Lax`, path `/` cookie. Record failed attempts by username/IP; block the pair for 15 minutes after five failures and always return the same invalid-credentials message.

Create `bootstrapAdmin()` in `src/lib/services/users.ts`; it reads the two bootstrap environment variables only when no administrator exists, creates that account, then does not read them again. Add an administrator-only organizer creation/reset/deactivation service that requires reassignment of active tournaments.

- [ ] **Step 4: Add login form, server actions, and protected panel layout**

The login form has `username`, `password`, and a submit button named `Iniciar sesion`. The action calls `signIn`, sets the session cookie on success, and redirects to `/`. The panel layout calls `requireUser`; unauthenticated requests redirect to `/login`. Admin-only pages call `requireRole('admin')`.

- [ ] **Step 5: Run authentication tests and lint**

Run: `npm run test -- tests/unit/password.test.ts tests/integration/auth.test.ts && npm run lint`

Expected: PASS. Verify the test database contains password hashes but no plaintext passwords.

- [ ] **Step 6: Commit authentication**

```bash
git add src/lib/auth src/lib/services/users.ts src/app/actions/auth.ts 'src/app/(auth)' 'src/app/(panel)/layout.tsx' src/components/auth tests/unit/password.test.ts tests/integration/auth.test.ts
git commit -m "feat: add username authentication"
```

## Task 4: Add Tournament, Court, Participant, and Registration Management

**Files:**
- Create: `src/lib/domain/types.ts`, `src/lib/domain/validation.ts`, `src/lib/services/tournaments.ts`, `src/lib/services/participants.ts`
- Create: `src/app/actions/tournaments.ts`, `src/app/actions/participants.ts`
- Create: `src/app/(panel)/page.tsx`, `src/app/(panel)/tournaments/new/page.tsx`, `src/app/(panel)/tournaments/[tournamentId]/page.tsx`, `src/app/(panel)/tournaments/[tournamentId]/participants/page.tsx`
- Create: `src/components/panel/tournament-form.tsx`, `src/components/panel/participant-form.tsx`
- Create: `tests/unit/validation.test.ts`, `tests/integration/participants.test.ts`

**Interfaces:**
- Produces `createTournament(input): Promise<TournamentWithCourts>` and `updateTournament(input): Promise<TournamentWithCourts>`.
- Produces `createParticipant(input): Promise<Participant>` and `replaceRegistrations(participantId, categories, version): Promise<Participant>`.
- Produces `assertTournamentOwner(user, tournament): void`.

- [ ] **Step 1: Write tournament and participant validation tests**

```ts
// tests/unit/validation.test.ts
import { expect, it } from 'vitest'
import { validateParticipant } from '@/lib/domain/validation'

it('allows a level from 1 to 5', () => {
  expect(validateParticipant({ name: 'Ana', gender: 'woman', level: 5, categories: ['women', 'mixed'] })).toEqual({ ok: true })
})

it('rejects an incompatible category', () => {
  expect(validateParticipant({ name: 'Ana', gender: 'woman', level: 3, categories: ['men'] }).ok).toBe(false)
})
```

```ts
// tests/integration/participants.test.ts
it('rejects a stale participant edit instead of overwriting it', async () => {
  const participant = await createParticipant(validParticipant)
  await replaceRegistrations(participant.id, ['women'], participant.version)
  await expect(replaceRegistrations(participant.id, ['women', 'mixed'], participant.version)).rejects.toThrow('Datos desactualizados')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/validation.test.ts tests/integration/participants.test.ts`

Expected: FAIL because domain validation and participant services do not exist.

- [ ] **Step 3: Implement minimal validation and persistence services**

Define unions in `domain/types.ts`: `Gender = 'man' | 'woman'`, `Category = 'men' | 'women' | 'mixed'`, `TournamentState`, `MatchState`, and `MatchFormat`. `validateParticipant` requires a non-empty trimmed name, integer level 1-5, and categories allowed by gender. `createTournament` copies global defaults, creates its three named courts, and assigns exactly one organizer. Every update includes the record version in the `where` clause and increments it.

- [ ] **Step 4: Implement the operator pages and actions**

Create a dashboard listing only the current organizer's tournaments, except for administrators who see all. The tournament form collects the exact fields in the spec. The participants page supports add, edit, and category checkboxes only while the tournament is a draft. Render server validation messages next to the submitted form and revalidate the relevant path after a successful action.

- [ ] **Step 5: Run integration tests and build**

Run: `npm run test -- tests/unit/validation.test.ts tests/integration/participants.test.ts && npm run build`

Expected: PASS. Confirm that a woman cannot be persisted in `men` and that edits after teams are locked are rejected server-side.

- [ ] **Step 6: Commit tournament setup**

```bash
git add src/lib/domain/types.ts src/lib/domain/validation.ts src/lib/services/tournaments.ts src/lib/services/participants.ts src/app/actions/tournaments.ts src/app/actions/participants.ts 'src/app/(panel)' src/components/panel tests/unit/validation.test.ts tests/integration/participants.test.ts
git commit -m "feat: manage tournaments and participants"
```

## Task 5: Implement Balanced Team Proposals and Team Locking

**Files:**
- Create: `src/lib/domain/pairing.ts`, `src/lib/services/teams.ts`
- Create: `src/app/actions/teams.ts`, `src/app/(panel)/tournaments/[tournamentId]/teams/page.tsx`, `src/components/panel/team-proposal.tsx`
- Create: `tests/unit/pairing.test.ts`, `tests/integration/teams.test.ts`

**Interfaces:**
- Produces `proposeTeams(category, participants): TeamProposal[]`.
- Produces `validateCategoryTeams(category, teams): CategoryValidation`.
- Produces `saveTeams(categoryId, draftTeams, version): Promise<Team[]>` and `lockTeams(tournamentId): Promise<void>`.

- [ ] **Step 1: Write pairing and locking tests**

```ts
// tests/unit/pairing.test.ts
import { expect, it } from 'vitest'
import { proposeTeams } from '@/lib/domain/pairing'

it('pairs highest and lowest levels in a same-gender category', () => {
  const teams = proposeTeams('men', [player('a', 5), player('b', 4), player('c', 2), player('d', 1)])
  expect(teams.map((team) => team.levelTotal)).toEqual([6, 6])
})

it('pairs descending men with ascending women in mixed', () => {
  const teams = proposeTeams('mixed', [man('m5', 5), man('m2', 2), woman('w1', 1), woman('w4', 4)])
  expect(teams.map((team) => team.memberIds)).toEqual([['m5', 'w1'], ['m2', 'w4']])
})
```

```ts
// tests/integration/teams.test.ts
it('rejects locked categories with three teams', async () => {
  await saveTeams(categoryId, threeTeams, categoryVersion)
  await expect(lockTeams(tournamentId)).rejects.toThrow('potencia de dos')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/pairing.test.ts tests/integration/teams.test.ts`

Expected: FAIL because pairing and team services do not exist.

- [ ] **Step 3: Implement pairing and category validation**

For men and women, sort by descending level then stable ID and pair outer positions. For mixed, split by gender, require equal counts, sort men descending and women ascending, then pair matching positions. Return unpaired participant IDs when mixed registrations are unbalanced. `validateCategoryTeams` requires two or more teams, a power of two team count, unique participants in the category, and exactly one man plus one woman in mixed.

- [ ] **Step 4: Persist proposals, manual changes, cancellation, and lock transition**

The teams page first shows proposals and each team total. It allows editing members and shows a non-blocking balance warning. The organizer can cancel an invalid category or return the tournament to draft before any match starts; returning to draft deletes pending bracket matches and schedules in one transaction. `lockTeams` locks registrations and teams, cancels explicitly chosen invalid categories, and refuses to continue when none remain active.

- [ ] **Step 5: Run pairing tests**

Run: `npm run test -- tests/unit/pairing.test.ts tests/integration/teams.test.ts`

Expected: PASS, including equal-gender mixed validation, manually unbalanced teams, and invalid team counts.

- [ ] **Step 6: Commit team formation**

```bash
git add src/lib/domain/pairing.ts src/lib/services/teams.ts src/app/actions/teams.ts 'src/app/(panel)/tournaments/[tournamentId]/teams' src/components/panel/team-proposal.tsx tests/unit/pairing.test.ts tests/integration/teams.test.ts
git commit -m "feat: propose and lock balanced teams"
```

## Task 6: Build the Double-Elimination Bracket Engine

**Files:**
- Create: `src/lib/domain/bracket.ts`, `src/lib/services/brackets.ts`
- Create: `tests/unit/bracket.test.ts`, `tests/integration/brackets.test.ts`

**Interfaces:**
- Produces `buildBracket(input: BuildBracketInput): BracketMatch[]`.
- Produces `advanceBracket(matches, result): BracketMatch[]`.
- Produces `isPowerOfTwo(value: number): boolean` and `isFinalStage(stage: MatchStage): boolean`.
- Produces `createBrackets(tournamentId): Promise<void>`.

- [ ] **Step 1: Write deterministic bracket tests for 2, 4, and 8 teams**

```ts
// tests/unit/bracket.test.ts
import { expect, it } from 'vitest'
import { buildBracket } from '@/lib/domain/bracket'

it('creates a reduced double-elimination bracket for two teams', () => {
  const matches = buildBracket({ categoryId: 'men', teamIds: ['a', 'b'] })
  expect(matches.map((match) => match.stage)).toEqual(['winners-final', 'grand-final', 'grand-final-reset'])
})

it('routes a first-round loser into the losers bracket for four teams', () => {
  const matches = buildBracket({ categoryId: 'men', teamIds: ['a', 'b', 'c', 'd'] })
  const firstRound = matches.find((match) => match.key === 'W1-1')!
  expect(firstRound.loserTo).toMatchObject({ key: 'L1-1', slot: 'a' })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/bracket.test.ts tests/integration/brackets.test.ts`

Expected: FAIL because the bracket engine does not exist.

- [ ] **Step 3: Implement a generic bracket builder**

Use `roundCount = Math.log2(teamIds.length)`. Build winners rounds `W1` through `WR`; each round halves the match count. For each losers round `L1` through `L(2R-2)`, use `teamCount / 2 ** Math.floor((round + 3) / 2)` matches. Route first-winners-round losers in pairs to `L1`; route losers from winners round `r >= 2` to losers round `2r - 2`; route every losers round winner to the next losers round, except the last, which routes to the grand final. Route winners-final winner to the grand final. Build a disabled reset match sourced from the grand-final winner and loser; it becomes active only when the losers-bracket champion wins the grand final.

Mark `winners-final`, `losers-final`, `grand-final`, and `grand-final-reset` as `best-of-three`; all other stages are `one-set-nine`. Keep route keys and slots in the in-memory model, then persist them to `matches` and `matchSlots`.

- [ ] **Step 4: Persist complete category brackets in one transaction**

`createBrackets` loads each locked active category, creates its bracket, writes all matches and slots, creates an unguessable public token if absent, and moves the tournament to `in_progress`. It must fail when teams are not locked, a category is invalid but not canceled, or there are no active categories.

- [ ] **Step 5: Run bracket tests**

Run: `npm run test -- tests/unit/bracket.test.ts tests/integration/brackets.test.ts`

Expected: PASS for 2, 4, and 8 teams, including winner and loser routes and conditional reset activation.

- [ ] **Step 6: Commit bracket generation**

```bash
git add src/lib/domain/bracket.ts src/lib/services/brackets.ts tests/unit/bracket.test.ts tests/integration/brackets.test.ts
git commit -m "feat: generate double elimination brackets"
```

## Task 7: Implement Scoring, Result Recording, Corrections, and Substitutions

**Files:**
- Create: `src/lib/domain/scoring.ts`, `src/lib/services/matches.ts`
- Create: `src/app/actions/matches.ts`
- Create: `tests/unit/scoring.test.ts`, `tests/integration/matches.test.ts`

**Interfaces:**
- Produces `validateScore(format, sets): ScoreValidation`.
- Produces `recordResult(input: RecordResultInput): Promise<Match>`.
- Produces `recordForfeit(input: ForfeitInput): Promise<Match>`.
- Produces `clearResult(matchId, version): Promise<void>` and `substitutePlayer(input): Promise<void>`.

- [ ] **Step 1: Write scoring and progression tests**

```ts
// tests/unit/scoring.test.ts
import { expect, it } from 'vitest'
import { validateScore } from '@/lib/domain/scoring'

it('accepts short winning scores and rejects a score without nine games', () => {
  expect(validateScore('one-set-nine', [{ home: 9, away: 8 }]).ok).toBe(true)
  expect(validateScore('one-set-nine', [{ home: 9, away: 7 }]).ok).toBe(true)
  expect(validateScore('one-set-nine', [{ home: 8, away: 7 }]).ok).toBe(false)
})

it('accepts a best-of-three result after two winning sets', () => {
  expect(validateScore('best-of-three', [{ home: 6, away: 4 }, { home: 7, away: 6 }]).ok).toBe(true)
})
```

```ts
// tests/integration/matches.test.ts
it('refuses to edit a result after a dependent match finishes', async () => {
  await recordResult(firstMatchResult)
  await recordResult(dependentMatchResult)
  await expect(clearResult(firstMatchId, firstMatchVersion)).rejects.toThrow('partidos posteriores')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/scoring.test.ts tests/integration/matches.test.ts`

Expected: FAIL because scoring and match services do not exist.

- [ ] **Step 3: Implement score validation and atomic result advancement**

`validateScore` accepts only legal score lengths and winning set counts. For short matches accept 9-0 through 9-7 with a two-game margin, or 9-8; for long sets accept 6-0 through 6-4 with a two-game margin, or 7-6. `recordResult` checks match state and version, persists the score and actual finish, resolves the winner and loser slots of downstream matches, activates the reset only when the losers-bracket champion wins the grand final, and detects when all active categories are complete.

`recordForfeit` records 9-0 for short format and 6-0, 6-0 for long format with `absence` or `retirement`. Only scheduled matches can be marked in progress; only scheduled or in-progress matches can finish. `clearResult` rejects any completed dependent match. `substitutePlayer` permits one replacement per team only before that team begins a match, then verifies category and gender eligibility.

- [ ] **Step 4: Add actions with strict authorization**

Every action loads the tournament and calls `assertTournamentOwner`, except an administrator who may operate any tournament. Authorization does not bypass score, bracket, scheduling, or correction checks. Revalidate the match board and public page after a mutation.

- [ ] **Step 5: Run result tests**

Run: `npm run test -- tests/unit/scoring.test.ts tests/integration/matches.test.ts`

Expected: PASS for normal results, both automatic-result formats, reset final activation, stale versions, result corrections, and substitutions.

- [ ] **Step 6: Commit result operations**

```bash
git add src/lib/domain/scoring.ts src/lib/services/matches.ts src/app/actions/matches.ts tests/unit/scoring.test.ts tests/integration/matches.test.ts
git commit -m "feat: record tournament results"
```

## Task 8: Implement Automatic Scheduling and Replanning

**Files:**
- Create: `src/lib/domain/scheduling.ts`, `src/lib/services/scheduling.ts`
- Modify: `src/lib/services/brackets.ts`, `src/lib/services/matches.ts`, `src/lib/services/tournaments.ts`
- Create: `tests/unit/scheduling.test.ts`, `tests/integration/scheduling.test.ts`

**Interfaces:**
- Produces `scheduleReadyMatches(input: SchedulingInput): ScheduledMatch[]`.
- Produces `replanPendingMatches(tournamentId, from: Date): Promise<void>`.
- Produces `assertManualSchedule(input): void`.

- [ ] **Step 1: Write scheduler tests**

```ts
// tests/unit/scheduling.test.ts
import { expect, it } from 'vitest'
import { scheduleReadyMatches } from '@/lib/domain/scheduling'

it('does not overlap a player entered in mixed and men', () => {
  const schedule = scheduleReadyMatches(twoReadyMatchesSharingPlayer)
  expect(schedule[1].startsAt.getTime()).toBeGreaterThanOrEqual(schedule[0].endsAt.getTime() + 20 * 60_000)
})

it('uses the long duration for a winners final', () => {
  const schedule = scheduleReadyMatches([readyWinnersFinal])
  expect(schedule[0].endsAt.getTime() - schedule[0].startsAt.getTime()).toBe(90 * 60_000)
})
```

```ts
// tests/integration/scheduling.test.ts
it('moves pending matches when the uncovered court is disabled', async () => {
  await disableCourt(uncoveredCourtId)
  const pending = await listPendingMatches(tournamentId)
  expect(pending.every((match) => match.courtId !== uncoveredCourtId)).toBe(true)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/scheduling.test.ts tests/integration/scheduling.test.ts`

Expected: FAIL because scheduling functions do not exist.

- [ ] **Step 3: Implement the pure scheduling algorithm**

Sort ready matches by downstream-dependent count descending, then by ready timestamp ascending. For each match, search enabled courts and chronological slots for the earliest interval that does not overlap an existing court reservation or either team's participant reservations plus the tournament rest duration. Choose the shorter or longer duration from match format. Reserve a conditional long slot after the grand final plus rest for the reset match. If no interval exists before the tournament end, schedule the earliest valid interval after it and return `afterEndWarning: true`.

- [ ] **Step 4: Persist and trigger replanning**

When brackets are created, schedule only ready first-round matches and the conditional reset reservation. After a result, forfeit, actual end time, court enable/disable, or authorized manual move, replan only scheduled pending matches; never move an in-progress or completed match. `assertManualSchedule` throws for court, participant, and rest conflicts rather than allowing a forced override.

- [ ] **Step 5: Run scheduler tests**

Run: `npm run test -- tests/unit/scheduling.test.ts tests/integration/scheduling.test.ts`

Expected: PASS for two/three courts, shared players, rest, long finals, priority, closure of a court, delays, and end-time warnings.

- [ ] **Step 6: Commit scheduling**

```bash
git add src/lib/domain/scheduling.ts src/lib/services/scheduling.ts src/lib/services/brackets.ts src/lib/services/matches.ts src/lib/services/tournaments.ts tests/unit/scheduling.test.ts tests/integration/scheduling.test.ts
git commit -m "feat: schedule and replan matches"
```

## Task 9: Build the Operator Interface and Global Administration

**Files:**
- Create: `src/app/(panel)/admin/organizers/page.tsx`, `src/app/actions/organizers.ts`
- Create: `src/app/(panel)/tournaments/[tournamentId]/matches/page.tsx`, `src/components/panel/match-board.tsx`
- Modify: `src/app/(panel)/page.tsx`, `src/app/(panel)/tournaments/[tournamentId]/page.tsx`, `src/app/globals.css`
- Create: `tests/e2e/operator.spec.ts`

**Interfaces:**
- Consumes `createTournament`, `createParticipant`, `lockTeams`, `createBrackets`, `recordResult`, `recordForfeit`, `replanPendingMatches`, and organizer services.
- Produces accessible forms and actions for all authenticated operational tasks.

- [ ] **Step 1: Write the failing operator browser flow**

```ts
// tests/e2e/operator.spec.ts
import { expect, test } from '@playwright/test'

test('organizer creates a tournament and reaches the team proposal', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Usuario').fill('organizador1')
  await page.getByLabel('Contrasena').fill('padel-seguro1')
  await page.getByRole('button', { name: 'Iniciar sesion' }).click()
  await page.getByRole('link', { name: 'Nuevo torneo' }).click()
  await page.getByLabel('Nombre').fill('Relampago')
  await page.getByRole('button', { name: 'Crear torneo' }).click()
  await expect(page.getByRole('heading', { name: 'Participantes' })).toBeVisible()
})
```

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/operator.spec.ts`

Expected: FAIL because the dashboard navigation and forms are incomplete.

- [ ] **Step 3: Implement compact server-rendered panel pages**

Use ordinary semantic forms and Server Actions, not a client state library. The tournament detail page shows state, active categories, enabled courts, warnings, and links to participants, teams, and matches. The match board groups matches by court and time, shows scheduled/in-progress/finalized state, provides actions to start, record score, record absence/retirement, move a pending match, and disable the uncovered court. Give all form controls explicit labels.

The admin organizer page creates accounts, resets passwords, assigns a tournament to a new organizer, and refuses deactivation until active tournaments are reassigned. Show global default duration/rest/end-time fields only to the administrator.

- [ ] **Step 4: Add responsive styling without a component framework**

Use `globals.css` for a narrow palette, system font stack, grid cards, readable bracket tables, and a single-column layout below 720px. Use buttons and inputs with clear focus styles. Do not add a CSS framework or icon dependency.

- [ ] **Step 5: Run browser, unit, lint, and build checks**

Run: `npm run test:e2e -- tests/e2e/operator.spec.ts && npm run test && npm run lint && npm run build`

Expected: PASS. Manually verify the board can be operated on a narrow viewport.

- [ ] **Step 6: Commit the operator panel**

```bash
git add 'src/app/(panel)' src/app/actions/organizers.ts src/components/panel/match-board.tsx src/app/globals.css tests/e2e/operator.spec.ts
git commit -m "feat: add tournament operator panel"
```

## Task 10: Build the Public Tournament View

**Files:**
- Create: `src/lib/services/public.ts`, `src/app/public/[publicToken]/page.tsx`, `src/components/public/tournament-view.tsx`, `src/components/public/refresh-button.tsx`
- Create: `tests/integration/public.test.ts`, `tests/e2e/public.spec.ts`

**Interfaces:**
- Produces `getPublicTournament(token): Promise<PublicTournament | null>`.
- Produces an unauthenticated public route that refreshes every 30 seconds.

- [ ] **Step 1: Write public visibility tests**

```ts
// tests/integration/public.test.ts
import { expect, it } from 'vitest'
import { getPublicTournament } from '@/lib/services/public'

it('does not expose a regenerated public token', async () => {
  const tournament = await seededPublicTournament()
  await regeneratePublicToken(tournament.id)
  await expect(getPublicTournament(tournament.publicToken)).resolves.toBeNull()
})
```

```ts
// tests/e2e/public.spec.ts
import { expect, test } from '@playwright/test'

test('public visitors can view the bracket without a login', async ({ page }) => {
  await page.goto(process.env.PUBLIC_TOURNAMENT_URL!)
  await expect(page.getByRole('heading', { name: 'Cuadros' })).toBeVisible()
  await expect(page.getByText('Ausencia')).toBeVisible()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/integration/public.test.ts && npm run test:e2e -- tests/e2e/public.spec.ts`

Expected: FAIL because the public service and route do not exist.

- [ ] **Step 3: Implement the read-only public projection**

`getPublicTournament` returns only tournament name, state, category names/states, court schedules, team member names, match scores, automatic-result reasons, and bracket routes. It must not return user IDs, participant levels, registration data, hashes, session data, or organizer data. The route returns `notFound()` for a missing or revoked token.

- [ ] **Step 4: Render public states and timed refresh**

Render `Proximamente` for a draft with a locked bracket, the live schedule and winners/losers brackets when in progress, and final/canceled status afterward. Add a small client component that calls `router.refresh()` every 30 seconds and an `Actualizar ahora` button. Regeneration uses an owner-authorized Server Action and invalidates the old token immediately.

- [ ] **Step 5: Run public tests**

Run: `npm run test -- tests/integration/public.test.ts && npm run test:e2e -- tests/e2e/public.spec.ts`

Expected: PASS without authentication, and revoked links return 404.

- [ ] **Step 6: Commit the public view**

```bash
git add src/lib/services/public.ts src/app/public src/components/public tests/integration/public.test.ts tests/e2e/public.spec.ts
git commit -m "feat: add public tournament view"
```

## Task 11: Add Deployment Configuration, Seed Data, and Full Verification

**Files:**
- Create: `scripts/seed-demo.ts`, `scripts/backup.sh`, `railway.json`, `README.md`
- Modify: `package.json`, `.env.example`, `docker-compose.yml`
- Create: `tests/e2e/full-tournament.spec.ts`

**Interfaces:**
- Produces `npm run seed:demo`, `npm run backup`, and a Railway build/start configuration.
- Produces one end-to-end demonstration from tournament setup to a public champion.

- [ ] **Step 1: Write the complete tournament browser test**

```ts
// tests/e2e/full-tournament.spec.ts
import { expect, test } from '@playwright/test'

test('runs a two-team category through a reset final', async ({ page }) => {
  await signInAsOrganizer(page)
  await createTwoTeamTournament(page)
  await recordResult(page, 'Final de ganadores', '6-0, 6-0')
  await recordResult(page, 'Gran final', '6-4, 6-4')
  await expect(page.getByText('Reinicio de gran final')).toBeVisible()
  await recordResult(page, 'Reinicio de gran final', '6-3, 6-3')
  await expect(page.getByText('Campeon')).toBeVisible()
})
```

- [ ] **Step 2: Run the end-to-end test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/full-tournament.spec.ts`

Expected: FAIL until the complete workflow is connected.

- [ ] **Step 3: Add operational scripts and Railway configuration**

`seed-demo.ts` creates one administrator, one organizer, a valid tournament, and enough participants for men, women, and mixed without writing plaintext production credentials. `backup.sh` creates `backups`, runs `pg_dump -Fc "$DATABASE_URL" -f "backups/padel-rush-$(date +%F-%H%M).dump"`, and deletes backups older than 30 days. `railway.json` runs `npm run build` and `npm run start`. Document Railway variables, PostgreSQL service linking, migration execution, the one-time bootstrap account, backup scheduling, and restoring a custom dump with `pg_restore`.

- [ ] **Step 4: Connect the full tournament flow and fix only observed failures**

Make the end-to-end helpers exercise real labels and Server Actions. Ensure the tournament switches to `finalizado` after every active category completes, or `cancelado` when the operator explicitly interrupts it. Ensure category cancellation from insufficient teams does not block valid categories.

- [ ] **Step 5: Run the full verification suite**

Run: `npm run test && npm run test:coverage && npm run lint && npm run build && npm run test:e2e`

Expected: every command exits with code 0. Run `docker compose up --build` and confirm the app starts with a PostgreSQL health check.

- [ ] **Step 6: Commit deployment readiness**

```bash
git add scripts railway.json README.md package.json package-lock.json .env.example docker-compose.yml tests/e2e/full-tournament.spec.ts
git commit -m "chore: document Railway deployment"
```

## Plan Review

### Spec coverage

- Authentication, roles, account lifecycle, rate limiting, and bootstrap account: Tasks 2-3 and 9.
- Tournament states, defaults, courts, participants, registrations, and cancellation: Tasks 2 and 4.
- Balanced same-gender and mixed pairing, manual adjustment, category validity, and locking: Task 5.
- Generic double elimination, reduced two-team bracket, all match formats, and reset final: Tasks 6-7.
- Auto scheduling, delays, court loss, rest, manual edits, conditional reset, and end warnings: Task 8.
- Operator workflow, public view, public-link revocation, 30-second refresh, and responsive UI: Tasks 9-10.
- PostgreSQL migrations, Docker, Railway, backups, tests, and deployment verification: Tasks 1-2 and 11.

### Consistency checks

- `MatchFormat`, `MatchStage`, and score validation are introduced before services and UI consume them.
- Bracket route keys are persisted as `matchSlots` before result recording resolves routes.
- Scheduler input consumes only ready matches from persisted bracket state and never moves in-progress or completed matches.
- No task relies on a player account, email address, or a service outside PostgreSQL and Railway.
