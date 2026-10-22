# Smart Room Realtime Control Platform

Local-first IoT/realtime systems design project.

Goal: design and build a small but realistic platform for monitoring and controlling a smart room
using event-driven architecture, realtime UI, telemetry, simulated devices and minimal real
hardware.

Core focus:

- system design
- event contracts
- device state model
- realtime control UI
- telemetry and reliability
- AI-assisted implementation with human-owned architecture

Documentation starts in [docs/README.md](docs/README.md).

## Local Development

Install all npm workspaces from the repository root:

```bash
npm install
```

Run the backend and frontend together:

```bash
npm run dev
```

The backend BFF listens on `http://localhost:4310`, and the Vite frontend uses
its default local dev URL.

`shared` exposes the local `@smart-room/contracts` workspace, which owns
runtime dependencies used by platform contracts, such as TypeBox.

## Tests

Backend tests run by group with `npm run test:backend:unit` and
`npm run test:backend:integration`; `npm run test:backend` runs both. Integration
uses native-source/transport doubles with the real backend and temporary SQLite.
Frontend unit/component/hook tests run with `npm run test:frontend`. Shared
contracts and simulator tests stay in their workspaces. See
[Test Suite Boundaries](docs/decisions/adr-test-suite-boundaries.md).

The [`frontend-e2e` workspace](frontend-e2e/README.md) owns deterministic browser
integration against a mocked BFF. Full-system E2E belongs in `e2e/`.
Run the frontend browser suite from the
repository root:

```bash
npm run test:frontend-e2e
```

The suite starts only the Vite frontend and a test-local mocked BFF; it does
not start the production backend or simulator. Install the Chromium browser
binary first when it is not already available:

```bash
npm run install:frontend-e2e
```

When a browser test fails, Playwright retains its trace, screenshot and video
artifacts in `test-results/frontend-integration`.
