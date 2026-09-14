# Task 5 Implementation Report

## Status

Task 5 is implemented and committed.

## Commit

Implementation commit: `8283ffb` (`feat: propose and lock balanced teams`).

## Files Changed

- `src/lib/domain/pairing.ts`
- `src/lib/services/teams.ts`
- `src/app/actions/teams.ts`
- `src/app/(panel)/tournaments/[tournamentId]/teams/page.tsx`
- `src/app/(panel)/tournaments/[tournamentId]/page.tsx`
- `src/components/panel/team-proposal.tsx`
- `tests/unit/pairing.test.ts`
- `tests/integration/teams.test.ts`

Pairing is deterministic for same-gender and mixed categories, reports unpaired mixed registrations, validates team shape/gender/count/participant uniqueness, and persists versioned drafts through the Task 4 tournament/category row locks. The teams page supports proposals, member edits, balance warnings, category cancellation, locking, and returning pending bracket data to draft.

## Commands And Results

| Command | Result |
| --- | --- |
| `npm run test -- tests/unit/pairing.test.ts tests/integration/teams.test.ts` before implementation | Failed as expected because `@/lib/domain/pairing` and `@/lib/services/teams` did not exist. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test -- tests/unit/pairing.test.ts tests/integration/teams.test.ts` | Passed: 2 files, 13 tests. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test` | Passed: 10 files, 47 tests. |
| `npx tsc --noEmit` | Passed. |
| `npm run lint` | Passed with no errors or warnings. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run build` | Passed: Next.js production build and TypeScript checks completed successfully; `/tournaments/[tournamentId]/teams` was generated as a dynamic route. |
| `git diff --cached --check` | Passed with no whitespace errors. |
| `git commit -m "feat: propose and lock balanced teams"` | Passed: created commit `8283ffb`. |

## Concerns

- The teams UI and actions have no browser E2E coverage; browser coverage is deferred to the later operator-panel task.
- Bracket generation and scheduling are not present yet, so return-to-draft removes pending match rows and associated teams while later tasks own bracket creation and scheduling.

## Review Fix Report

### Commit

Fix commit: `6f0d664` (`fix: harden team locking validation`).

### Findings Addressed

- Lock validation now compares every stored team member ID with every participant registered in the category, rejecting omitted or extra registrations for mixed and same-gender categories.
- `TeamProposal.members` is required, and `validateCategoryTeams` returns a clear error when runtime callers omit member data before checking mixed-gender rules.
- `cancelCategory(categoryId, version)` now requires an integer optimistic version and rejects stale cancellation requests.
- Added integration coverage for mixed persistence, unpaired mixed and odd same-gender registrations, duplicate and wrong-gender service writes, registration locking, started-match rollback rejection, stale cancellation, and cross-owner action authorization.
- The teams page passes its tournament/category draft state into `TeamProposal`, so save/cancel controls are not rendered outside editable draft state.

### Verification

| Command | Result |
| --- | --- |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test -- tests/unit/pairing.test.ts tests/integration/teams.test.ts` before fixes | Failed as expected: 5 regression tests failed while 18 existing focused tests passed. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test -- tests/unit/pairing.test.ts tests/integration/teams.test.ts` | Passed: 2 files, 24 tests. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test` | Passed: 10 files, 58 tests. |
| `npx tsc --noEmit` | Passed. |
| `npm run lint` | Passed with no errors or warnings. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run build` | Passed: Next.js production build and TypeScript checks completed successfully. |
| `git diff --cached --check` | Passed with no whitespace errors. |
| `git commit -m "fix: harden team locking validation"` | Passed: created commit `6f0d664`. |

### Remaining Concerns

- Browser E2E coverage remains deferred to the later operator-panel task.
- Bracket generation and scheduling remain deferred to later tasks.
