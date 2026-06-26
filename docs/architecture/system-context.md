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
backend read model/projections: materialized views of current device state,
active command state and recent event history. The realtime API/BFF reads those
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
frontend connects and streams later `room.snapshot` messages after accepted
temperature telemetry updates the read model. It also periodically rereads the
projection so time-derived health changes such as `stale` and `offline` are
pushed even when telemetry stops. The frontend does not interpret raw platform
events.

The BFF also keeps `GET /room` as a debug/read snapshot endpoint for the latest
`RoomSnapshotProjection`; it is not the frontend runtime fallback. `GET
/diagnostics` exposes recent ignored event-processing outcomes so the
development runtime can explain rejected duplicate or invalid events. The
diagnostics response is bounded in-memory, newest-first and metadata-only; it is
not event history or durable quarantine storage. Command handling, persistence
and quarantine storage are still future slices.
