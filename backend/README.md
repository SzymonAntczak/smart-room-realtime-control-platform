# Backend

The backend owns the local platform boundary between device-like sources and
the realtime UI. It translates external observations into platform events,
validates and deduplicates them, derives backend read-model projections, and
exposes UI-oriented realtime APIs.

The completed Stage 2/2.5 temperature slice runs a simulated sensor through
the adapter, event processor, projection and realtime BFF. It broadcasts
time-derived `stale` and `offline` health changes even while telemetry is
paused. Its development-only scenario endpoint drives the same simulator and
event path as normal readings; ignored duplicates and invalid payloads are
available through diagnostics. The Stage 3 LED reference slice adds explicit
HTTP command acceptance and realtime command lifecycle projections.

## Structure

- `src/platform/` contains stable backend platform behavior shared by all
  sources.
- `src/adapters/` contains source-specific translators for simulators, hardware
  or external systems.
- `src/testing/` contains backend tests that span multiple backend boundaries.

## Commands

- `npm --prefix backend run dev`
- `npm --prefix backend run test`
- `npm --prefix backend run typecheck`
- `npm --prefix backend run lint`

The local development BFF listens on `http://localhost:4310` by default. The
frontend runtime reads room state from `http://localhost:4310/room/realtime` using SSE.
`GET http://localhost:4310/room` remains available as a debug/read snapshot
endpoint. Runtime event processing diagnostics are available at
`GET http://localhost:4310/diagnostics`. The port can be overridden with `PORT`.

The in-memory event deduplicator can be configured at server startup with
`DEDUPLICATION_RETENTION_MS` (default `600000`) and
`DEDUPLICATION_ENTRY_LIMIT` (default `1000`). Both values must be positive safe
integers; an invalid value prevents the server from starting.

`npm run dev` from the repository root enables development-only device scenario
endpoints automatically. When starting the backend directly, set
`ENABLE_DEV_SCENARIOS=true` to expose those endpoints; leave it unset for the
normal backend runtime.

Use the repository architecture docs and accepted ADRs as the source of truth
for event, command, device and reliability behavior.
