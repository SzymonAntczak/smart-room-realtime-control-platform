# Smart Room Frontend

React, TypeScript and Vite control surface for the Smart Room realtime platform.

The frontend displays temperature telemetry and LED command state from the
local realtime runtime. It receives a `room.snapshot` baseline followed by
validated device and command updates over SSE, keeps the last valid view
during reconnects, and makes availability, health and observation freshness
visible. Development-only, device-scoped scenarios control the simulator through
the backend; one shared sidebar swaps temperature or LED content for the card
that opened it.

`VITE_BFF_URL` configures the shared HTTP origin for development scenarios and
diagnostics and user history. `VITE_ROOM_REALTIME_URL` independently configures the SSE endpoint,
and `VITE_ROOM_COMMAND_URL` configures the LED command endpoint. Each has a
localhost default for the local BFF.

The Dashboard history panel consumes strict BFF user entries from the same SSE
connection and `/room/history/user-history?pageSize=50`. One open session pins
generation, watermark and retention time, caches up to 5,000 HTTP entries and
200 live entries, and runs one fetch at a time. It preserves a reading anchor
through live merge and bounded recovery, labels last-known/error/limited history,
and releases its cache when closed. ST-4-06a-05 adds measured virtual rendering
with stable record keys, five overscan entries per side and keyboard-accessible
scrolling and controls. Width changes preserve the first unobscured reading
anchor; DOM rows and measurement observers are released as the range changes.
Raw significant-fact sessions are not a frontend product
path; the separate telemetry history session remains available and tested.

## Source Of Truth

- Frontend working rules: [AGENTS.md](AGENTS.md)
- Shared platform contracts: [../shared/src](../shared/src)
- Architecture model: [../docs/architecture](../docs/architecture)
- Accepted decisions: [../docs/decisions](../docs/decisions)

## Structure

- `src/main.tsx`: Vite/React bootstrap.
- `src/globals.css`: global reset and shared design tokens.
- `src/app/App.tsx`: application composition root.
- `src/app/history`: bounded HTTP/SSE history sessions.
- `src/app/realtime`: validated realtime projection client and hook.
- `src/app/dev/dev-panel`: development-only sidebar that discovers and renders
  device scenarios.
- `src/app/dev/scenarios`: declarative LED and temperature scenario definitions.
- `src/app/controls/led`: LED command UI and command transport boundary.
- `src/app/sensors/temperature`: temperature sensor domain UI and behavior.
- `src/app/shared/ui`: frontend-local reusable UI building blocks.
- `src/test`: global test setup only.

## Scripts

Run commands from `frontend/`.

```powershell
npm run dev
npm run lint
npm run typecheck
npm test
npm run format
npm run build
```

Use `npm run format:write` only when intentionally updating formatting.
Use `npm run verify:production-bundle` when a change could affect which modules
reach the production bundle, especially the development-only UI.

Run the deterministic browser-integration suite from the repository root,
not from `frontend/`:

```powershell
npm run test:browser
```

It starts only the Vite frontend and a test-local mocked BFF; it does not start
the production backend or simulator. If Chromium is not installed yet, run
`npm run install:browser` from the repository root first. Failed tests retain
Playwright trace, screenshot and video artifacts in
`test-results/frontend-integration`.

## Verification Focus

Before finishing frontend work, prefer the narrowest useful checks and make sure
the completed temperature slice still shows:

- the temperature sensor name
- the current temperature value and unit
- the last reading time
- realtime connection and device-health status, including stale and offline
  states while retaining the last known reading
- recent accepted temperature events that explain the current reading
- reconnect and invalid-realtime-contract feedback without rendering invalid
  room state
