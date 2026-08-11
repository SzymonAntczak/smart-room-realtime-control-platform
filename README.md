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

Run the deterministic frontend browser-integration reference suite from the
repository root:

```bash
npm run test:browser
```

The suite starts only the Vite frontend and a test-local mocked BFF; it does
not start the production backend or simulator. Install the Chromium browser
binary first when it is not already available:

```bash
npm run install:browser
```

When a browser test fails, Playwright retains its trace, screenshot and video
artifacts in `test-results/frontend-integration`.
