# Smart Room Frontend

React, TypeScript and Vite control surface for the Smart Room realtime platform.

The current Stage 1 implementation is intentionally small: one read-only
simulated temperature sensor with a realtime-updating frontend value. Broader
control behavior, backend realtime transport and simulator integration remain
later slices.

## Source Of Truth

- Frontend working rules: [AGENTS.md](AGENTS.md)
- Shared platform contracts: [../shared/src/contracts.ts](../shared/src/contracts.ts)
- Architecture model: [../docs/architecture](../docs/architecture)
- Accepted decisions: [../docs/decisions](../docs/decisions)

## Structure

- `src/main.tsx`: Vite/React bootstrap.
- `src/globals.css`: global reset and shared design tokens.
- `src/app/App.tsx`: minimal temperature sensor UI and local realtime simulation.
- `src/app/App.module.css`: styles for the current sensor view.
- `src/app/App.test.tsx`: user-visible behavior tests for the sensor view.
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
the current slice still shows:

- the temperature sensor name
- the current temperature value and unit
- the last reading time
- a visible simulated realtime source/status
