# ST-4-06a-01 Contract Acceptance

## Execution contract

Objective: deliver additive TypeBox user-history item, HTTP and BFF SSE
contracts and frontend validation adapters, without activating the new wire
format. This is one subtask of the still-open DS-4-06a story. No database,
processor, raw fact, command lifecycle, UI, fetching or cursor implementation
change is included. Implementation stays in the existing local checkout.

Binding sources:

- [User-history ADR](../decisions/adr-user-history-projection-and-virtualized-feed.md):
  product classification, BFF response contract and HTTP/realtime boundary.
- [JSON Schema ADR](../decisions/adr-json-schema-transport-contracts.md):
  TypeBox canonical schemas and boundary validation.
- [Realtime ADR](../decisions/adr-room-realtime-synchronization.md):
  revision, projection and generation/watermark semantics.
- Approved plan and explicit user selection: schemas/adapters only; transport
  activation belongs to later subtasks.

## Specification lock and acceptance criteria

The acceptance-mapped scenarios below in the three new contract/client test
groups are the specification lock. Existing raw-contract/client tests provide
regression evidence and remain unchanged.

| ID   | Required outcome / source                                                                          | Executable evidence and scenario                                                                                                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Six meanings; no technical progress, payloads or diagnostics. User-history ADR.                    | `shared/src/user-history.test.ts`: given supported/unsupported meanings, when validated, then accept supported entries and reject technical variants/extra fields and known no-change values.                                                   |
| AC-2 | Stable source identity/time and durable/volatile discrimination across HTTP/SSE. User-history ADR. | User-history tests and `shared/src/room-bff.test.ts`: given HTTP/SSE copies, when validated, then IDs/time/sequences agree; invalid durability combinations fail.                                                                               |
| AC-3 | Bounded pinned pages, source ordering, durable-only contents and sparse pages. User-history ADR.   | User-history tests and `frontend/src/app/history/user-history-client.test.ts`: given filtered pages, when validated, then sparse/empty pages with a cursor remain valid; duplicate IDs/sequences, wrong order and values beyond watermark fail. |
| AC-4 | Existing projection and revision invariants remain enforced. JSON Schema and realtime ADRs.        | Room-BFF tests: given invalid revisions, storage or command references, when validated, then reject; valid command progress, watermark-only and telemetry deltas remain accepted.                                                               |
| AC-5 | Invalid data never returns partially validated client state. JSON Schema ADR.                      | User-history client tests and `frontend/src/app/realtime/room-bff-client.test.ts`: given malformed entries/errors/baselines, when passed as unknown data, then return invalid_response without mutating/coercing the input.                     |
| AC-6 | Current raw transport/client behavior remains intact. Approved scope.                              | Existing shared contract suite and frontend room-realtime-client/room-history-session suites, plus explicit separation tests in room-bff.test.ts.                                                                                               |

Checkpoints: after shared schemas, run their contract tests; after client
adapters, run new boundary and current-client regression tests. Stop for a human
decision if a change requires platform semantics, transport activation or
scope expansion. No subsequent subtask starts automatically.

## Definition of done

- DoD-1: AC-1–AC-6 have passing evidence and executed checks are recorded below.
- DoD-2: ADR documents the new shape and pending integration; backlog completes
  only ST-4-06a-01.
- DoD-3: diff contains no database, processor, command lifecycle or production
  wire-format changes.
- DoD-4: independent bounded delivery review has no blocking findings.

Stop condition: all acceptance criteria and DoD items pass. No Goal was
created; the user requested implementation of the approved plan.

## Verification record

Run date: 2026-09-28.

- `npm run test:contracts`: PASS, 9 files / 92 tests (AC-1–AC-4, AC-6).
- `npm run test --workspace @smart-room/frontend -- user-history-client room-bff-client room-realtime-client room-history-session`:
  PASS, 4 files / 62 tests (AC-3–AC-6).
- `npm run typecheck`: PASS for all four workspaces.
- `npm run typecheck:browser`: PASS with current mocked-BFF contracts unchanged.
- Scoped lint and formatting: PASS; exact replay commands appear below.
- Initial acceptance run failed because the new contract module did not yet
  exist. During implementation, TypeScript found schema inference and mutable
  negative-test fixture issues; lint found imports/spacing/unused bindings.
  Those failures were corrected before the final checks.

No Playwright run is required: this subtask changes neither UI nor active
transport. No migration, database, runtime, platform schema or existing client
change is present. Raw schemas continue accepting current fixtures and reject
the new BFF presentation format, and vice versa.

Independent delivery gate: `DELIVERY_REVIEW: PASS` from the configured
`smart_room_delivery_reviewer`. No blocking findings or in-scope verification
gaps. The reviewer independently reran the shared/targeted frontend tests,
workspace/browser typechecks, scoped ESLint/Prettier and `git diff --check`.
The administrative advisory to replace the pending review line is resolved by
this record. AC-1–AC-6 and DoD-1–DoD-4 are complete; the parent story remains open.

### Stop-hook follow-up

The session verification hook subsequently ran broader checks. Contracts,
full frontend (143 tests), simulator (49 tests), repository lint and typechecks
passed. Its first full backend run failed on four 5-second timeouts in the
existing room-BFF/bootstrap tests, with a temporary-directory cleanup EPERM
after one timeout. No assertion failure in the new contracts was reported.

The failures did not reproduce in follow-up runs, with no source/configuration
changes or timeout increase:

- `npm run test:backend -- room-bff.test.ts backend-bootstrap.test.ts`: PASS,
  2 files / 46 tests.
- `npm run test:backend`: PASS, 27 files / 371 tests, default settings.

The initial backend run took 35.67 seconds overall; the successful full rerun
took 10.29 seconds. This supports a transient timing/resource explanation but
does not establish the exact cause. The original failure remains recorded
rather than being treated as a consistently successful run.

Scoped checks (globs match only this subtask's nine new TypeScript files):

```powershell
npm run lint:files -- "shared/src/user-history*.ts" "shared/src/room-bff*.ts" "frontend/src/app/history/user-history-client*.ts" "frontend/src/app/realtime/room-bff-client*.ts"
npm run format:files -- "shared/src/user-history*.ts" "shared/src/room-bff*.ts" "frontend/src/app/history/user-history-client*.ts" "frontend/src/app/realtime/room-bff-client*.ts" shared/package.json docs/decisions/adr-user-history-projection-and-virtualized-feed.md docs/architecture/events-and-commands.md docs/planning/backlog.md docs/planning/user-history-contract-acceptance.md
```
