# Task 8a Report: Pure Scheduling Domain

## Status

Complete. Steps 1-3 and 5 of the Task 8 brief are implemented and committed: the pure scheduler plus its unit tests. Services, actions, integration tests, and replanning (steps 4 and 6) are intentionally out of scope for this dispatch.

## Commit

`32d243e1e0ac95939fe14838c202a9e5cc5fc6d6` (`feat: add pure match scheduling domain`)

## Files

- `src/lib/domain/scheduling.ts` (new): `scheduleReadyMatches(input: SchedulingInput): ScheduledMatch[]` and its input/output types.
- `tests/unit/scheduling.test.ts` (new): 9 unit tests.

## Design

- `SchedulingMatch`: `id`, `format`, `participantIds`, `readyAt`, optional `dependentCount`.
- `SchedulingCourt`: `id`, `enabled`.
- `SchedulingInput`: matches, courts, tournament start/end, short/long minutes, rest minutes, and optional `courtReservations`, `participantReservations`, `conditionalResets`.
- `ScheduledMatch`: `matchId`, `courtId`, `startsAt`, `endsAt`, `afterEndWarning`, `conditional`.
- Sorting: downstream-dependent count descending, then `readyAt` ascending.
- Duration: `best-of-three` uses the long minutes; `one-set-nine` uses the short minutes.
- Placement: walks each enabled court chronologically from `max(tournament start, readyAt)`, pushing past existing court bookings, court reservations, and either team's participant bookings/reservations widened by the rest minutes; picks the enabled court with the earliest valid start.
- Conditional reset: reserved after the grand final's end plus rest, always long format, marked `conditional: true`.
- End-time warning: no interval is rejected for being past the tournament end; `afterEndWarning` is `true` when the assigned interval ends after the limit.
- Throws `No hay canchas habilitadas` when matches are requested with no enabled courts.

## Commands And Results

| Command | Result |
| --- | --- |
| `npm run test -- tests/unit/scheduling.test.ts` | Passed: 1 file, 9 tests. |
| `npx tsc --noEmit` | Passed. |
| `npm run lint` | Passed with no errors or warnings. |
| `DATABASE_URL=postgres://padel:padel@localhost:5432/padel_rush npm run test` | Passed: 15 files, 100 tests. |
| `git commit -m "feat: add pure match scheduling domain"` | Created `32d243e`. |

Without `DATABASE_URL` the integration suites fail to reach PostgreSQL; that is pre-existing and unrelated to this change.

## Test Coverage

- Shared player across mixed and men does not overlap and respects rest.
- Long duration for a final (`best-of-three` = 90 minutes).
- Existing court and participant reservations push the next start past reservation plus rest.
- Priority order by downstream-dependent count.
- Tie-break by ready order.
- Three matches with two courts stack; with three courts all start in parallel.
- Disabled courts are never used.
- Matches past the tournament end are scheduled and flagged with `afterEndWarning`.
- Conditional reset is reserved after the grand final plus rest.

## Concerns

- The scheduler assumes all matches have known participants; bracket-derived future matches are expected to stay pending until ready (that gating belongs to the service layer).
- If a match's duration exceeds the whole tournament window the scheduler still assigns an interval after the end with a warning, per the spec; there is no separate hard failure.
- Cross-court participant conflicts are handled via the participant bookings the scheduler itself creates plus caller-supplied reservations; the service layer must pass in-progress/completed matches as reservations so replanning does not move or collide with them.
- The conditional reset ignores participants for conflict resolution since both finalists are unknown at reservation time; the service layer may need to re-check on activation.
