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
diagnostics and history. `VITE_ROOM_REALTIME_URL` independently configures the SSE endpoint,
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
Raw significant-fact and telemetry history sessions are not frontend product
paths. Backend integration verifies telemetry HTTP/SSE contracts with native-source
doubles and real BFF/SQLite; there is no production telemetry-history client or live session.

## Source Of Truth

- Frontend working rules: [AGENTS.md](AGENTS.md)
- Shared platform contracts: [../shared/src](../shared/src)
- Architecture model: [../docs/architecture](../docs/architecture)
- Accepted decisions: [../docs/decisions](../docs/decisions)

## Structure

- `src/main.tsx`: Vite/React bootstrap and build-mode selection.
- `src/globals.css`: global reset and shared design tokens.
- `src/app/App.tsx`: production composition root.
- `src/app/pages/dashboard/useRoom.ts`: dashboard room connection lifecycle,
  renderable room state and synchronous room-to-history integration.
- `src/app/api/commands`: LED command HTTP client and validation.
- `src/app/api/history`: history HTTP client and validation.
- `src/app/api/room`: validated SSE client, revisions, reconnect and BFF snapshots.
- `src/app/pages/dashboard`: dashboard composition, local device projections,
  display names and LED and temperature controls, plus history presentation and session.
- `src/app/i18n`: initialization, locale detection and translations.
- `src/app/features/date-time`: shared timestamp formatting.
- `src/app/ui`: reusable UI building blocks.
- `src/app/dev`: development composition, scenario definitions and device sidebar.
- `src/test`: global test setup and shared domain fixtures and mocks, including room SSE fixtures.

Frontend-owned modules use `History` names; shared `UserHistory` contracts,
wire `userHistory` fields and the BFF history endpoint retain their protocol
names. Small test helpers stay in their test file; reusable fixtures and mocks
live under `src/test`. Application folders contain no `*.test-support.*` files,
and production entrypoints never export test helpers.

Feature and API resource modules expose named exports through small `index.ts`
entrypoints; API resources have no aggregate `api/index.ts`. Import private
files only inside their owner.
Keep modules in `features` only when they have actual reuse across independent
consumers, including modules within one page. Page-specific components, hooks,
models, sessions and tests belong with their owning components or hooks; tests
and hypothetical future reuse do not establish sharing. Production HTTP/SSE
transport belongs in `api`, which depends only on shared contracts, external
non-React libraries and other public API resource modules. Development-only
transport remains in `dev`.
Dependency directions and test seams are specified in
[frontend guidelines](../docs/development/frontend-guidelines.md#application-structure-and-imports)
and checked during review. ESLint enforces filename conventions; it does not
check module import directions or feature/API cycles. Dashboard's `useRoom` hook connects the room API to the
shared history source, publishing history before the new room view. Dashboard
components use this shared state without opening additional room connections.

## Scripts

Frontend unit, component and hook tests run in this workspace. From the root,
`npm run test:browser` runs Playwright against a mocked BFF; backend integration
runs separately with `npm run test:backend:integration` and imports no frontend.
Root-level E2E smoke is reserved for the full system with its real sources.

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
