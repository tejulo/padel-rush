# Task 7 Implementation Report

## Status

Task 7 is implemented and committed. The interrupted partial work was evaluated, corrected where incomplete or overbuilt, extended with missing coverage, and verified.

## Commit

Implementation commit: `f780917989d8829059f7ed507da204f18f6c2477` (`feat: record tournament results`).

## Files Changed

- `src/lib/domain/scoring.ts` (new)
- `src/lib/services/matches.ts` (new)
- `src/app/actions/matches.ts` (new)
- `src/lib/db/schema.ts` (modified: `teams.substitutionUsed`)
- `drizzle/0004_grey_colossus.sql`, `drizzle/meta/0004_snapshot.json`, `drizzle/meta/_journal.json` (new/modified migration)
- `tests/unit/scoring.test.ts` (new)
- `tests/integration/matches.test.ts` (new)

## Evaluation Of The Partial Work

Kept: score validation shape, row-lock transaction pattern, persisted-route advancement (`routeResult`), conditional-reset activation model, dependent-match correction ordering, substitution eligibility rules, and the `substitutionUsed` migration.

Fixed or tightened:

- Simplified the over-defensive `ForfeitInput` (five alias fields, winner-derivation) to a single `forfeitTeamId` and removed the duplicated `forfeitMatchAction` alias.
- Simplified reset activation: the grand-final `b` slot is always the losers champion, so the deep `teamCameThroughLosers` walk was removed while keeping the exact-row atomic activation (`state = pending`, `resultReason = null`, version bump).
- `clearResult` downgrade of category/tournament now uses guarded `WHERE state = ...` updates.
- `assertPlayable` now distinguishes plain cancelled matches from the conditional reset.
- Added integration coverage for the 8-team losers path through the reset to a finished tournament, in-progress result recording, reverse-order corrections, second-result rejection, pending-start rejection, ineligible substitutions, and admin authorization with sports validation still enforced.

## Requirements Verification

- Score formats: one-set-nine accepts 9-0..9-7 (two-game margin) and 9-8; best-of-three accepts 6-0..6-4 and 7-6 with exactly two winning sets and no extra set. Unit tests cover both sides and rejections.
- Forfeit: records `9-0` short and `6-0, 6-0` long with `absence`/`retirement`; verified for both formats.
- Transitions: `startMatch` only from `scheduled`; `recordResult`/`recordForfeit` only from `scheduled` or `in_progress`.
- Conditional reset: unactivated row stays `cancelled` / `conditional-reset`; when the losers champion (`b`) wins the grand final the exact row is activated atomically in the same transaction; clearing the grand final reverts it to cancelled.
- Corrections: `clearResult` rejects when any dependent match is `completed`/`forfeit` (`partidos posteriores`) or `in_progress`; reverse-order clearing works.
- Substitution: once per team via `teams.substitutionUsed`, only before the team's first match, registration + category gender validation, and no duplicate participant in the category.
- Completion: category finishes when all its matches are terminal; tournament finishes when every active category is finished or cancelled.
- Actions: each loads the tournament and calls `assertTournamentOwner` (admin bypass by ownership rule, still applying sports validation), then revalidates the board and public page.

## Commands And Results

| Command | Result |
| --- | --- |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run db:migrate` | Passed; 5 migrations applied, `substitution_used` present as `boolean NOT NULL DEFAULT false`. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test -- tests/unit/scoring.test.ts tests/integration/matches.test.ts` | Passed: 2 files, 18 tests. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test` | Passed: 14 files, 89 tests. |
| `npx tsc --noEmit` | Passed. |
| `npm run lint` | Passed with no errors or warnings. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run build` | Passed: Next.js production build and TypeScript checks completed successfully. |
| `git diff --cached --check` | Passed with no whitespace errors. |
| `git commit -m "feat: record tournament results"` | Passed: created commit `f780917`. |

## Concerns

- Reset activation relies on the bracket invariant that the grand-final `b` slot is the losers-bracket champion; if a future bracket variant changes that routing, this check must be revisited.
- `routeResult` refuses to advance into a destination that is already `in_progress`, which surfaces the correction ordering but is covered only indirectly by tests.
- Substitution does not re-validate the whole category for duplicates created by a later manual registration change; it validates the replacement against current team membership.
- Scheduling is not triggered after results yet; Task 8 owns replanning and may need to call into `finishMatch`/`clearResult` paths.
- Integration verification requires the local PostgreSQL service and the explicit `DATABASE_URL` shown above.
