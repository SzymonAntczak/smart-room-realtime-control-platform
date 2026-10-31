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
Temperature device details use `/room/history/telemetry` for an independent
live chart and static measurement list. The chart keeps up to 200 samples with
HTTP recovery and live updates. The list pages through retained measurements
with its own device/date criteria and explicit refresh, bounded to 10,000 samples
and 100 pages. Both expose loading, empty, limited and error states.
Raw significant-fact history remains a technical inspection surface. Backend
integration verifies telemetry HTTP/SSE contracts with native-source doubles and
real BFF/SQLite.

## Source Of Truth

- Frontend working rules: [AGENTS.md](AGENTS.md)
- Shared platform contracts: [../shared/src](../shared/src)
- Architecture model: [../docs/architecture](../docs/architecture)
- Accepted decisions: [../docs/decisions](../docs/decisions)

## Structure

- `src/main.tsx`: Vite/React bootstrap, browser router creation and build-mode selection.
- `src/globals.css`: global reset and shared design tokens.
- `src/app/routing`: route table, lazy page loading, loading/error feedback and page-not-found rendering.
- `src/app/api`: resource-scoped HTTP/SSE clients and response validation.
- `src/app/pages/dashboard`: dashboard composition, local device projections,
  LED and temperature controls, live history sidebar and independent search modal.
- `src/app/pages/device-details`: selected-device view, live telemetry chart,
  independent static telemetry list and device-scoped event-history composition.
- `src/app/shared/history`: history sessions, domain adapters, live feed and static results.
- `src/app/shared/device-filters`: reusable draft/applied device/date forms.
- `src/app/shared/infinite-scrolling`: generic cursor sessions, scroll paging and virtual lists.
- `src/app/shared/room-realtime`: persistent room connection, validated snapshots and
  synchronous room-to-history source bridge.
- `src/app/shared/date-time` and `src/app/shared/device-display`: timestamp and device-name presentation.
- `src/app/shared/ui`: reusable UI building blocks.
- `src/app/i18n`: initialization, locale detection and translations.
- `src/app/dev`: development composition, scenario definitions and device sidebar.
- `src/test`: global test setup and shared domain fixtures and mocks.

Frontend-owned modules use `History` names; shared `UserHistory` contracts,
wire `userHistory` fields and the BFF history endpoint retain their protocol
names. Small test helpers stay in their test file; reusable fixtures and mocks
live under `src/test`. Application folders contain no `*.test-support.*` files,
and production entrypoints never export test helpers.

Shared and API resource modules expose named exports through small `index.ts`
entrypoints; API resources have no aggregate `api/index.ts`. Import private
files only inside their owner.
Keep modules in `shared` only when they have actual reuse across independent
consumers, including modules within one page. Page-specific components, hooks,
models, sessions and tests belong with their owning components or hooks; tests
and hypothetical future reuse do not establish sharing. Production HTTP/SSE
transport belongs in `api`, which depends only on shared contracts, external
non-React libraries and other public API resource modules. Development-only
transport remains in `dev`.
Dependency directions and test seams are specified in
[frontend guidelines](../docs/development/frontend-guidelines.md#application-structure-and-imports)
and checked during review. ESLint enforces filename conventions; it does not
check module import directions or shared-module/API cycles. `RoomProvider` connects the
room API to the shared history source, publishing history before the new room
view. Dashboard and Device Details share that provider across navigation.
Pages compose independent business modules and wire their actions. Shared modules
may import other shared public APIs; prefer page composition when a module would
otherwise manage another business module's lifecycle. History exposes
`LiveHistoryFeed`, `useHistorySearch` and `HistoryResults`; modal and device
views connect search to their own filter provider.
Each history context owns its HTTP session; only the Dashboard sidebar merges
SSE additions. Search and device history stay static until explicitly refreshed.

## Scripts

Frontend unit, component and hook tests run in this workspace. From the root,
`npm run test:frontend-e2e` runs Playwright against a mocked BFF; backend integration
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

Browser integration is owned by the separate
[`frontend-e2e` workspace](../frontend-e2e/README.md). Run it from the repository root:

```powershell
npm run test:frontend-e2e
```

It starts only the Vite frontend and a test-local mocked BFF; it does not start
the production backend or simulator. If Chromium is not installed yet, run
`npm run install:frontend-e2e` from the repository root first. Failed tests retain
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
