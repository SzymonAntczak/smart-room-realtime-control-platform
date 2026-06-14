# Backend

The backend owns the local platform boundary between device-like sources and
the realtime UI. It translates external observations into platform events,
validates those events, derives backend read-model projections and will expose
UI-oriented realtime APIs.

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

The local development BFF listens on `http://localhost:4310` by default. Its
current snapshot endpoint is `GET http://localhost:4310/room`. Runtime event
processing diagnostics are available at `GET http://localhost:4310/diagnostics`.
The port can be overridden with `PORT`.

Use the repository architecture docs and accepted ADRs as the source of truth
for event, command, device and reliability behavior.
