# Task 4 Implementation Report

## Status

Task 4 is implemented and committed.

## Commit

Implementation commit: `aa1228c19b62bfdbbf6e7e551b3cf6a7f62bafcc` (`feat: manage tournaments and participants`).

## Files Changed

- `src/lib/domain/types.ts`
- `src/lib/domain/validation.ts`
- `src/lib/services/tournaments.ts`
- `src/lib/services/participants.ts`
- `src/app/actions/tournaments.ts`
- `src/app/actions/participants.ts`
- `src/app/(panel)/page.tsx`
- `src/app/(panel)/tournaments/new/page.tsx`
- `src/app/(panel)/tournaments/[tournamentId]/page.tsx`
- `src/app/(panel)/tournaments/[tournamentId]/participants/page.tsx`
- `src/components/panel/tournament-form.tsx`
- `src/components/panel/participant-form.tsx`
- `tests/unit/validation.test.ts`
- `tests/integration/participants.test.ts`
- `src/app/page.tsx` was removed because the protected `(panel)/page.tsx` now owns `/`.

The existing tournament service was extended with defaults, court configuration, ownership checks, filtered listing, optimistic tournament updates, and detail queries. Participant creation, editing, registration replacement, draft/locked checks, category compatibility, and optimistic versions are transactional. Server Actions use `requireUser`, `assertTournamentOwner`, server-side form parsing, validation error state, and path revalidation.

## Commands And Results

| Command | Result |
| --- | --- |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test -- tests/unit/validation.test.ts tests/integration/participants.test.ts` before implementation | Failed as expected: both suites could not import the missing domain validation and participant service modules. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test -- tests/unit/validation.test.ts tests/integration/participants.test.ts` | Passed: 2 test files, 7 tests. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test` | Passed: 7 test files, 24 tests. |
| `npm run lint` | Passed with no errors or warnings. |
| `npm run build` | Passed: Next.js production build and TypeScript checks completed successfully. |
| `git diff --cached --check` | Passed with no whitespace errors. |
| `git commit -m "feat: manage tournaments and participants"` | Passed: created commit `aa1228c19b62bfdbbf6e7e551b3cf6a7f62bafcc`. |

## Concerns

- Task 2 has no persisted global-settings table, so the requested creation defaults are represented by service constants (`21:00`, `40`, `90`, and `20`); administrator-editable global settings remain outside this task.
- No browser E2E coverage was added; the requested focused unit and integration coverage, lint, and production build pass.

## Review Fix Report

### Commit

Fix commit: `81fc17a7930aab576921f5fe5185254d518433bb` (`fix: harden tournament management`).

### Findings Addressed

- `createTournament` now requires an active user with `role = 'organizer'`.
- Creation defaults, including the enabled court count, are resolved before validation, so a `22:00` start with the default `21:00` end is rejected.
- `lockTournamentForWrite` locks the tournament and all category rows with `FOR UPDATE`; participant creation, participant edits, and registration replacement use it before checking draft/category state. Task 5 can reuse this helper and `TournamentTransaction`.
- Added integration coverage for organizer/admin visibility, organizer-only assignment, default time validation, cross-owner authorization, tournament versions, court toggles, and the concurrent category-lock boundary.

### Verification

| Command | Result |
| --- | --- |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test -- tests/integration/participants.test.ts tests/integration/tournaments.test.ts tests/unit/validation.test.ts` before fixes | Failed as expected: 2 of 14 tests failed for administrator assignment and resolved default time validation; the other 12 passed. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test -- tests/integration/participants.test.ts tests/integration/tournaments.test.ts tests/unit/validation.test.ts` | Passed: 3 test files, 14 tests. |
| `npm run lint` | Passed with no errors or warnings. |
| `npm run build` before resolved-input type correction | Failed on the expected TypeScript optional-property error in `src/lib/services/tournaments.ts`. |
| `npm run build` | Passed: Next.js production build and TypeScript checks completed successfully. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test` | Passed: 8 test files, 31 tests. |
| `git diff --cached --check` | Passed with no whitespace errors. |
| `git commit -m "fix: harden tournament management"` | Passed: created commit `81fc17a7930aab576921f5fe5185254d518433bb`. |

### Remaining Concerns

- Minor default duplication and timezone-format validation remain deferred as instructed.
- Browser E2E coverage remains outside this fix.
