# ADR: Test Suite Boundaries

## Status

Accepted

## Context

Realtime history, command confirmation and recovery need deterministic tests
across module boundaries. A suite combining the backend, storage and private
frontend hooks makes ownership unclear and duplicates client scenarios without
exercising a real browser. Full-system tests also cost more to arrange and debug
than tests of the module responsible for a failure.

## Options Considered

- Maintain a separate cross-package transport suite with frontend hooks in a
  simulated browser environment.
- Separate frontend and backend integration at their public boundaries, with a
  small full-system smoke suite protecting actual runtime wiring.
- Move all integration and failure scenarios into full-system E2E tests.

## Decision

Frontend unit, component and hook tests protect frontend-owned behavior.
Frontend Playwright integration runs the real frontend against a test-local
mocked BFF with shared-contract-valid HTTP and SSE messages.

Backend unit tests protect module behavior, contracts, adapters, storage and
runtime orchestration. Backend integration tests live in the backend package
and replace only the native source or its transport client. Native messages
pass through the real adapter, input coordination, processing, persistence and
HTTP/SSE API. Storage-dependent integration uses temporary real SQLite databases.
The integration suite must not import frontend code or arrange platform events
and projections in place of native input.

After MQTT is introduced, backend integration may replace the source transport
client with a deterministic test double. It does not establish real broker or
device interoperability. Normal development and full-system E2E continue to use
the required real broker and ordinary source runtime.

Root-level E2E smoke tests belong under `e2e/` and exercise the real frontend,
backend and configured source infrastructure. They protect critical user
workflows and runtime wiring; the detailed failure matrix belongs to the owning
unit or integration suite.
Broker security and infrastructure acceptance retain their own required evidence.
Shared-contract and simulator tests remain with their respective packages.

## Consequences

Failures have a clear owner and most recovery scenarios can be driven with
controlled clocks, messages and transport behavior. Backend integration validates
real HTTP/SSE and persistence without requiring a browser or real device source.

Frontend and backend tests can both pass while their real composition is broken.
The E2E smoke suite and infrastructure acceptance therefore remain necessary.
Test doubles require native-contract fidelity, isolated subscriptions and explicit
command outcomes; accepting a command must not fabricate a state confirmation.
Real source idempotency and durable receipts are protected by source and receipt
tests, not claimed by the native-source double.

## Verification

- Frontend browser integration starts only the frontend and mocked BFF.
- Backend integration replaces native sources while using the real backend,
  temporary SQLite where applicable, and HTTP/SSE APIs; it imports no frontend.
- Temperature, command lifecycle, history identity, pinned pagination and storage
  recovery scenarios are assigned to the layer owning their observable result.
- Backend unit and integration groups run separately and together without
  discovering a test twice.
- Full-system smoke tests cover live telemetry, confirmed control and history,
  paged history with live additions, and recovery of the required broker path.

## Links

- [Reliability and Testing](../architecture/reliability-and-testing.md)
- [Playwright for Frontend Integration Tests](adr-playwright-frontend-integration-tests.md)
- [User History Projection and Virtualized Feed](adr-user-history-projection-and-virtualized-feed.md)
- [MQTT Source Parity Before Device Expansion](adr-mqtt-source-parity-before-device-expansion.md)
