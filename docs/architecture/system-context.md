# System Context

The system context below describes the target backend-backed shape of the Smart
Room platform.

```mermaid
flowchart LR
    subgraph external[External Sources]
        direction TB
        simulator[Event Simulator]
        hardware[Hardware Device]
    end

    subgraph adapters[Backend Adapters]
        direction TB
        simAdapter[Simulator Adapter]
        hardwareAdapter[Hardware Adapter]
    end

    subgraph platform[Backend Platform Core]
        direction LR
        processor[Event Processor]
        readModel[Read Model / Projections]
        storage[(In-Memory Storage)]

        processor --> readModel
        processor --> storage
        readModel --> storage
    end

    subgraph apiBoundary[Backend API Boundary]
        api[Realtime API / BFF]
    end

    subgraph client[Client]
        direction TB
        ui[Realtime Frontend]
        user[User]
    end

    simulator <-->|simulator-native messages / commands| simAdapter
    hardware <-->|device-native messages / commands| hardwareAdapter

    simAdapter -->|platform events| processor
    hardwareAdapter -->|platform events| processor

    readModel -->|snapshots / updates| api
    api <-->|WebSocket| ui
    ui <--> user

    api -->|command requests| processor
    processor -->|platform commands| simAdapter
    processor -->|platform commands| hardwareAdapter
```

In the broader target model, the simulator is the first external device source.
The backend simulator adapter turns simulator-native messages into platform
events and platform commands into simulator-native commands. A hardware adapter
can be added later without changing the frontend's mental model: simulator and
hardware sources are both handled behind backend-owned adapters.

The event processor owns validation, deduplication and command lifecycle rules.
It accepts, ignores or routes events to quarantine according to the platform
event contract and available storage capabilities. Accepted events update the
backend read model/projections: materialized views of current device and active
command state. The realtime API/BFF reads those
projections and streams UI-oriented snapshots or updates to the frontend; it
does not reinterpret raw device-native messages.

The realtime API/BFF also accepts command requests from the UI. Backend platform
code records and interprets command lifecycle facts, while adapters translate
platform commands into simulator-native, hardware-native or external-system
commands.

When backend and simulator slices are introduced, the realtime API, event
processor, read model/projections and in-memory storage belong to the local
backend. The simulator remains a separate project responsible for simulated
devices and scenarios. The simulator adapter belongs to the backend. The diagram
shows responsibility boundaries, not required production deployment boundaries.

## Current Implementation Status

The current repository implementation does not yet include the full target
context. The backend slice currently covers the simulator temperature telemetry
path through adapter, event processor, read-model projection and a small
realtime BFF.

The current BFF exposes `ws://localhost:4310/room/realtime` as the frontend
runtime path. The backend sends an initial `room.snapshot` message when the
frontend connects, then streams revision-linked `device.updated` messages after
projection changes. Snapshots and updates contain only current device state and
health; event history is deferred to a dedicated future slice. It periodically rereads the
projection, but emits only an actual time-derived health change such as
`stale` or `offline`. The frontend does not interpret raw platform
events.

The BFF also keeps `GET /room` as a debug/read snapshot endpoint for the latest
`RoomSnapshotProjection`; it is not the frontend runtime fallback. `GET
/diagnostics` exposes recent ignored event-processing outcomes so the
development runtime can explain rejected duplicate or invalid events. The
diagnostics response is bounded in-memory, newest-first and metadata-only; it is
not event history or durable quarantine storage. Command handling, persistence
and quarantine storage are still future slices.

## Development Scenario Controls

The local development runtime may expose a dev-only HTTP control boundary at
`GET` and `POST /dev/devices/:deviceId/scenarios`. A device-card dev control
loads scenarios lazily for its selected device and delegates a named simulator
scenario action to the backend runtime. It is not a product command API, is not
part of `room.snapshot`, and must not be enabled in production.
It is disabled by default and is enabled only when the backend process receives
`ENABLE_DEV_SCENARIOS=true`. The root `npm run dev` launcher sets this local
development flag deliberately; deployed or ad-hoc backend processes do not
inherit scenario mutation access by default.

The frontend development panel uses this boundary only to request simulator
behavior. The resulting observations still travel through the simulator adapter,
event processor, read model and normal realtime snapshot-plus-delta delivery path.
This preserves the distinction between dev tooling and user-facing room state.

The initial controls pause or resume scheduled telemetry, emit the next native
reading, replay the last native reading, emit a deliberately invalid reading,
and reset the simulator sequence. Reset restarts simulated telemetry and emits
a new first reading; it does not clear the backend's deduplication memory or
diagnostics. Replaying a reading preserves its adapter-created
platform event identity, so it exercises platform-event deduplication. An
invalid reading reaches platform validation and is visible through diagnostics
without changing the room projection.
