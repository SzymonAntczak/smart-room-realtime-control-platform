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
diagnostics. `VITE_ROOM_REALTIME_URL` independently configures the SSE endpoint.

## Source Of Truth

- Frontend working rules: [AGENTS.md](AGENTS.md)
- Shared platform contracts: [../shared/src/contracts.ts](../shared/src/contracts.ts)
- Architecture model: [../docs/architecture](../docs/architecture)
- Accepted decisions: [../docs/decisions](../docs/decisions)

## Structure

- `src/main.tsx`: Vite/React bootstrap.
- `src/globals.css`: global reset and shared design tokens.
- `src/app/App.tsx`: application composition root.
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
```

Use `npm run format:write` only when intentionally updating formatting.

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
