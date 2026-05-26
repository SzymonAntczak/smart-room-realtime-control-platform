---
name: smart-room-architecture-conformance
description: Use when auditing, reviewing, or planning whether Smart Room implementation, tests, simulator behavior, UI state, event contracts, and repository structure still match docs/architecture, docs/decisions, and planning docs. Trigger for architecture drift checks, docs-vs-code consistency reviews, implementation conformance audits, or deciding whether a mismatch should be fixed in code, tests, docs, or an ADR.
---

# Smart Room Architecture Conformance

Use this skill to check whether the repository still tells one coherent story:
documentation, implementation, tests, simulator behavior and user-visible
control states should agree.

## Required Sources

Start with:

- `README.md`
- `docs/README.md`
- `docs/planning/goal.md`
- `docs/planning/roadmap.md`
- `docs/architecture/README.md`

Then read the relevant architecture docs:

- `docs/architecture/system-overview.md`
- `docs/architecture/system-context.md`
- `docs/architecture/control-loop.md`
- `docs/architecture/events-and-commands.md`
- `docs/architecture/devices.md`
- `docs/architecture/reliability-and-testing.md`
- `docs/architecture/examples.md`

Check relevant decisions:

- `docs/decisions/README.md`
- `docs/decisions/adr-command-correlation-confirmation-and-concurrency.md`
- `docs/decisions/adr-device-command-confirmation-and-health-policy.md`
- `docs/decisions/adr-event-simulator-before-real-devices.md`
- `docs/decisions/adr-local-first-before-cloud.md`
- `docs/decisions/tradeoffs.md`

## Audit Workflow

1. Build a compact source-of-truth summary from docs before inspecting code.
2. Locate implementation areas for events, commands, state derivation,
   simulator scenarios, device health, UI state and tests.
3. Compare behavior against documented rules and ADR consequences.
4. Classify every mismatch:
   - `code drift`: implementation contradicts current docs or ADRs
   - `doc drift`: implementation appears intentional but docs are stale
   - `test gap`: expected behavior has no meaningful executable coverage
   - `decision gap`: behavior is ambiguous and needs an ADR or trade-off entry
5. Prefer concrete findings with file and line references over broad narrative.
6. Do not change code during a conformance audit unless the user explicitly
   asks for fixes after the review.

## Rules To Preserve

- Events are facts that already happened; commands are requests.
- Commands are intent, not proof of device state.
- Requested, pending, confirmed, failed, timed-out, stale and offline states
  must remain distinguishable when they are user-visible.
- Device reports are observable facts and may update current state even if late.
- A timed-out command must not later become confirmed because of a late device
  report.
- The first implementation allows only one pending command per device.
- Failure, stale data and missing data are user states, not hidden details.
- Simulator-first and local-first decisions remain active unless superseded by
  an ADR.

## Review Focus

Prioritize mismatches around:

- event envelope fields, event versions, payload names and lifecycle events
- command correlation, confirmation matching, timeout closure and concurrency
- derived device and room state from duplicated, delayed or missing events
- stale/offline transitions and reconnect behavior
- UI claims that make uncertain state look confirmed or healthy
- simulator scenarios that no longer exercise documented failure modes
- tests that assert implementation details while missing user-visible
  reliability behavior
- README, roadmap or examples that promise behavior the system no longer has

## Expected Output

Lead with findings ordered by severity. For each finding include:

- classification: `code drift`, `doc drift`, `test gap` or `decision gap`
- evidence from docs or ADRs
- evidence from implementation, tests or missing coverage
- recommended next action

If no findings are found, say that clearly and list the most important residual
risks or areas not covered by executable checks.
