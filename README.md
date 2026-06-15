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

Run the backend and frontend together:

```bash
npm run dev
```

The backend BFF listens on `http://localhost:4310`, and the Vite frontend uses
its default local dev URL.
