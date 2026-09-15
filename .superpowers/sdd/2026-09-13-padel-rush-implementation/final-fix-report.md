# Final Fix Wave Report

## Status

Complete. All findings from the final whole-branch review were addressed in one pass on `feat/padel-rush-implementation`.

## Commit

- `fix: close final review gaps` (this commit; report included)

## Files Changed

- `src/lib/services/tournaments.ts`: `cancelTournament(tournamentId, version)` (owner/admin checked in the action, draft/in_progress only, version-guarded, keeps results/categories/champion undecided), `deleteTournament(tournamentId, version, user)` (admin: finished/cancelled; organizer: own draft only), `assertTimezone` at create/update via `Intl.DateTimeFormat` in try/catch.
- `src/app/actions/tournaments.ts`: `cancelTournamentAction`, `deleteTournamentAction`, shared `versionFrom`, `redirect('/')` after deletion.
- `src/components/panel/tournament-actions.tsx`: client cancel/delete forms with `useActionState`, role-aware visibility.
- `src/app/(panel)/tournaments/[tournamentId]/page.tsx`: renders `TournamentActions`.
- `src/components/auth/login-form.tsx`, `src/app/actions/auth.ts`: `useActionState` login; `signInAction` returns `{ error: INVALID_CREDENTIALS_MESSAGE }`; `LoginState` type.
- `src/app/(panel)/layout.tsx`: logout form calling `signOutAction`.
- `src/lib/services/matches.ts`: board entries now carry team version/substitution eligibility and members, category replacement candidates, per-match `afterEndWarning`, conditional-reset row filtered; `moveMatch` takes a required `version` and rejects stale writes in the `WHERE`; `finishMatch` stamps `actualStartAt` when missing.
- `src/app/actions/matches.ts`: `moveMatchAction` forwards the version.
- `src/components/panel/match-board.tsx`: per-match and summary end-time alerts, substitution form per eligible team.
- `src/lib/services/scheduling.ts`, `src/lib/domain/scheduling.ts`: conditional reset reservation survives an `in_progress` grand final via `fixedInterval`.
- `src/lib/services/public.ts`, `src/components/public/tournament-view.tsx`: public court enabled/disabled state rendered; champion only when the category is `finished`.
- `src/lib/domain/bracket.ts`, `tests/unit/bracket.test.ts`: deleted dead `advanceBracket`, `cloneMatch`, `setRoutedTeam`, `BracketResult`; routing/reset coverage stays in integration tests.
- `src/lib/auth/session.ts`: non-blocking `pruneAuthData()` in `signIn`/`getSessionUser` (expired sessions, attempts older than 30 days).
- `Dockerfile`: runner stage creates non-root `nextjs` user.
- `README.md`: one-line note that the legacy `completed` enum value is kept to avoid a risky enum migration.
- Tests: `tests/integration/tournaments.test.ts` (cancel in-progress keeps results, illegal state, stale version, cross-organizer, delete allowed/rejected/action authorization, timezone), `tests/integration/matches.test.ts` (end-time flag, stale move, `actualStartAt`, reset filtering, substitution data), `tests/integration/scheduling.test.ts` (GF in-progress reset reservation), `tests/integration/public.test.ts` (courts, cancelled champion), `tests/integration/auth.test.ts` (sign-in action error, pruning), `tests/unit/scheduling.test.ts` (fixed interval reset).

## Verification

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed. |
| `npm run lint` | Passed, 0 warnings. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test` | 18 files, 128 tests passed. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run build` | Passed. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush SESSION_SECRET=test-secret npm run test:e2e` | 5 tests passed. |

## Concerns

- `pruneAuthData` runs as a fire-and-forget delete on sign-in/session reads; under a very hot path this adds two extra DELETE statements per request, but it is non-blocking and no failure can break auth.
- The `completed` tournament/category enum value is intentionally left in place (README note) because dropping a PostgreSQL enum value requires recreating the type.
- Substitution eligibility is recomputed in the board query; the server still enforces all rules, so a stale board can only show a form whose action is rejected.
- E2E runs against `npm run dev` locally (existing config); the dev server writes `.next/dev/types` and once raced `tsc` during this session — a `tsc` run concurrent with Playwright can hit a transient generated-file error.
