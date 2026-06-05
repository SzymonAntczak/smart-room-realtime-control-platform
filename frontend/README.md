# Smart Room Frontend

React, TypeScript and Vite control surface for the Smart Room realtime platform.

The frontend renders backend/shared room projections and lets the user send
command intent. It must keep reported device state, requested state, command
lifecycle, device health and uncertainty visible instead of collapsing them into
generic loading or error states.

## Source Of Truth

- Frontend working rules: [AGENTS.md](AGENTS.md)
- Shared platform contracts: [../shared/src/contracts.ts](../shared/src/contracts.ts)
- Architecture model: [../docs/architecture](../docs/architecture)
- Accepted decisions: [../docs/decisions](../docs/decisions)

## Structure

- `src/main.tsx`: Vite/React bootstrap.
- `src/globals.css`: global reset and shared design tokens.
- `src/app`: product code grouped by domain.
- `src/app/room-control`: room view model and dashboard composition.
- `src/app/room-realtime`: realtime client boundary and fixture client.
- `src/app/led-control`: LED command UI.
- `src/app/sensors`: device state cards.
- `src/app/event-feed`: recent platform event history.
- `src/app/shared`: low-level frontend UI and formatting helpers.
- `src/test`: global test setup only.

## Scripts

Run commands from `frontend/`.

```powershell
npm.cmd run dev
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run format
```

Use `npm.cmd run format:write` only when intentionally updating formatting.

## Realtime Modes

By default, the app connects to the local backend WebSocket:

```text
ws://localhost:8787/realtime
```

Set `VITE_REALTIME_URL` to point at another backend endpoint.

Set `VITE_REALTIME_MODE=fixture` to render the local fixture client without a
backend. Fixture data should demonstrate reliability states such as pending
commands, stale devices, offline devices and event history, not only happy paths.

## Verification Focus

Before finishing frontend work, prefer the narrowest useful checks and make sure
the UI still shows:

- requested state separately from reported state
- pending, failed and timed-out command states
- stale, offline and degraded device health
- command availability from backend/shared projections
- recent events that explain user actions and device reports
