# ADR: Stage 1 Local Runtime and Repository Boundaries

## Status

Accepted

## Context

The first implementation stage needs a working local vertical slice: simulated
devices, accepted events, derived room state, realtime UI updates and a simple
LED control command.

The project should stay small enough to build and explain, but the initial
runtime must still preserve the important system boundaries:

- events are facts that already happened
- commands are requests, not proof of device state
- the UI must distinguish requested, pending, confirmed, failed, timed-out,
  stale and offline states
- the simulator should exercise the same platform event and command contracts
  through a backend-owned adapter, without owning platform interpretation

The repository already has separate `frontend` and `simulator` directories, but
the simulator should not become the owner of backend responsibilities. The first
runtime decision should keep responsibilities separated in the repository while
avoiding production deployment complexity before the control loop exists.

## Options Considered

- Build a single full-stack application where frontend, simulator and event
  logic are tightly coupled.
- Build separate production-like services for API, simulator, event processor
  and storage from the beginning.
- Build separate frontend, backend, simulator and shared contract projects, but
  keep the Stage 1 backend local and lightweight.

## Decision

Use a local Stage 1 system made of:

- `frontend`: React, TypeScript and Vite for the realtime control UI.
- `backend`: Node.js and TypeScript for the local realtime API, event
  processor, command handling, in-memory storage and simulator adapter.
- `simulator`: Node.js and TypeScript for simulated devices, simulator
  scenarios and simulator-native messages.
- `shared`: TypeScript platform event, command and device-state contracts, plus
  adapter-facing message types when they need to be shared between backend and
  simulator.

The first implementation should separate responsibilities in code even if more
than one role later runs on the same local machine:

- the backend owns the realtime API, event processor, command handler and
  in-memory storage
- the backend owns the simulator adapter, which translates simulator-native
  messages into platform events and platform commands into simulator-native
  commands
- the simulator owns simulated device behavior, repeatable scenarios and its
  own device-facing protocol or message shape
- shared platform contracts are the common language for frontend, backend and
  backend adapters; simulator-facing shared types must not make the simulator
  responsible for platform event processing or command lifecycle interpretation

Use WebSocket as the Stage 1 realtime transport between the frontend and the
backend.

Use in-memory storage in the backend for Stage 1. It is acceptable for events
and derived state to be lost when the process restarts. Persistent storage can
be added later after the event contracts and control loop are working.

Use separate development commands for the first implementation, for example:

- `npm run dev:frontend`
- `npm run dev:backend`
- `npm run dev:simulator`

A combined `npm run dev` command can be added later as a convenience, but it is
not required for the initial runtime decision.

## Consequences

Using TypeScript across frontend, backend and simulator keeps event and command
contracts easy to share without forcing the project into a larger backend
framework early.

Using Node.js is appropriate for the initial local realtime workload: WebSocket
connections, event handling, simulator messages and UI-facing API concerns are
mostly I/O-oriented. CPU-heavy processing, strict realtime guarantees or large
distributed workloads would need a separate design decision later.

Using WebSocket matches the realtime control UI goal. It should be treated as
the live update and command-status channel, not as the only possible API shape
forever. Later implementations may still use HTTP for initial data loads,
history queries, configuration, authentication or administrative workflows.

Keeping backend responsibilities and adapters in a dedicated project prevents
the simulator from becoming a catch-all application. This makes later hardware
integration cleaner because real devices and the simulator can both be treated
as external device sources behind backend-owned adapters.

The backend can remain local and lightweight in Stage 1 without being treated
as a production microservice. This gives the project clear responsibility
boundaries while avoiding early deployment complexity.

In-memory storage keeps Stage 1 focused on the control loop. The system must not
pretend this is durable audit storage. Persistent event and telemetry storage
remain future work.

The frontend should consume current room snapshots and realtime updates from
the backend. It should not become the source of truth for device state or
command lifecycle interpretation.

## Acceptance Criteria

Stage 1 runtime setup is considered sufficient when:

- the frontend, backend and simulator can be started locally with documented
  commands
- shared TypeScript contracts are used across the platform boundary without
  making the simulator responsible for platform state interpretation
- the frontend receives an initial room snapshot
- the frontend receives realtime state or event updates over WebSocket
- a user command can be accepted as intent without being shown as confirmed
  state before a matching device report
- the backend keeps enough in-memory event history to explain recent user
  actions during a local demo
- the simulator does not own event processing, storage, adapter translation or
  UI-facing API responsibilities

## Links

- Related architecture document: [System Overview](../architecture/system-overview.md)
- Related architecture document: [System Context](../architecture/system-context.md)
- Related architecture document: [Control Loop](../architecture/control-loop.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related ADR: [Local-First Before Cloud](adr-local-first-before-cloud.md)
- Related ADR: [Event Simulator Before Real Devices](adr-event-simulator-before-real-devices.md)
