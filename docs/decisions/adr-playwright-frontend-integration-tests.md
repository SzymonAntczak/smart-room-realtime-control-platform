# ADR: Playwright for Frontend Integration Tests

## Status

Accepted

## Context

Stage 3.5 needs deterministic browser-level tests for the LED command loop.
They must drive the frontend in a real browser against a mocked BFF, without
starting the production backend or simulator. The test boundary must provide an
initial room snapshot, named SSE updates and `POST /room/commands` responses
through the existing shared transport contracts.

The project needs one durable tool choice before adding the reference suite.
The primary alternatives considered are Playwright and Cypress. Both provide
free, open-source local runners; paid hosted services are not required for this
project.

## Options Considered

- Playwright Test with TypeScript.
- Cypress.

## Decision

Use Playwright Test with TypeScript for the Stage 3.5 browser integration suite.

Each test starts the Vite frontend and a test-local mocked BFF. The mocked BFF
implements only the frontend-facing contract: `GET /room/realtime` as a
long-lived SSE stream and `POST /room/commands`. It produces schema-valid room
snapshots and revision-linked realtime updates, validates received command
requests, and exposes test-only scenario control outside the frontend.

Tests interact with the UI through accessible browser locators and assert
user-visible state. They must not start the production backend or simulator,
inject React/frontend state, or use simulator-native messages. Start with
Chromium; add other browser projects only when a concrete compatibility need
appears.

## Consequences

- The suite verifies the BFF contract boundary and user-visible control loop,
  while existing Vitest suites remain responsible for unit and component tests.
- A test-local SSE-capable BFF is required; simple completed-response network
  interception is insufficient for deterministic realtime updates.
- Playwright brings browser binaries and test artifacts into local/CI setup.
  Failure traces, screenshots and videos aid diagnosis without requiring a
  hosted service.
- Cypress remains a viable future alternative, but introducing it alongside
  Playwright would duplicate runner configuration and suite conventions.

## Verification

- `npm run test:browser` starts only the Vite frontend and mocked BFF, then runs
  the suite headlessly in Chromium.
- The browser suite covers normal and delayed confirmation, rejection, timeout,
  and a late report after timeout through BFF-contract messages.
- Tests prove requested power is never displayed as confirmed before a matching
  report and that a late report does not reconfirm a timed-out command.

## Links

- Related architecture document: [Reliability and Testing](../architecture/reliability-and-testing.md)
- Related architecture document: [System Overview](../architecture/system-overview.md)
- Related decision: [JSON Schema Transport Contracts](adr-json-schema-transport-contracts.md)
- Related decision: [LED Command Transport and Operational Defaults](adr-led-command-transport-and-operational-defaults.md)
