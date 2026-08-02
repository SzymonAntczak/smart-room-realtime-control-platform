# Smart Room Frontend

React, TypeScript and Vite control surface for the Smart Room realtime platform.

The completed Stage 2/2.5 reference slice is a read-only simulated temperature
sensor backed by the local realtime runtime. The UI receives a `room.snapshot`
baseline followed by `device.updated` messages over WebSocket, keeps the last valid reading during reconnects, makes
`stale` and `offline` health visible, and shows recent accepted temperature
events. A development-only scenario panel controls the simulator through the
backend and displays ignored-event diagnostics; it is separate from the
user-facing room surface. Command controls remain a later slice.

`VITE_BFF_URL` configures the shared HTTP origin for development scenarios and
diagnostics. `VITE_ROOM_REALTIME_URL` independently configures the WebSocket endpoint.

## Source Of Truth

- Frontend working rules: [AGENTS.md](AGENTS.md)
- Shared platform contracts: [../shared/src/contracts.ts](../shared/src/contracts.ts)
- Architecture model: [../docs/architecture](../docs/architecture)
- Accepted decisions: [../docs/decisions](../docs/decisions)

## Structure

- `src/main.tsx`: Vite/React bootstrap.
- `src/globals.css`: global reset and shared design tokens.
- `src/app/App.tsx`: application composition root.
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
