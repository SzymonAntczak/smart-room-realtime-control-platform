# System Overview

## Goal

Build a local-first realtime control platform for a smart room.

The system should be small enough to build incrementally, but realistic enough to exercise the hard parts of IoT-style systems:

- event-driven communication
- realtime user interface updates
- telemetry and event history
- simulated devices first, minimal real hardware later
- explicit handling of device availability, operational health, observation freshness and failures

## Domain Boundaries

The architecture is organized around the main domain concepts, not around implementation layers.

| Domain area | Responsibility                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Room state  | Current derived view of devices, telemetry, availability, health, freshness and active commands. |
| Devices     | Report observable state, receive commands, and expose availability and health evidence.          |
| Events      | Facts emitted by backend adapters, backend workflows or user-facing workflows.                   |
| Commands    | User or automation requests that may later succeed, fail or time out.                            |
| Telemetry   | Time-series readings and historical facts used for debugging and trends.                         |
| Realtime UI | Human-facing projection of state, command progress and history.                                  |

## Incremental Read Path

The temperature read path exposes two simulated sensors through backend
transport, adapter translation, event processing and a derived room projection.
The LED control path adds command handling, confirmation and bounded terminal
command projections. Durable storage owns history and restart recovery.

A minimal read path should show:

- the sensor name
- the current temperature reading
- the reading unit
- the last reading time
- that the value is coming from simulated realtime updates

Read and command paths share backend adapters, event processing and
observation-freshness handling.

## Target MVP Scope

The first useful system slice focuses on a small smart-room model.

The active MVP is deliberately limited to:

- one temperature-sensor role providing temperature telemetry;
- one controllable on/off output using `set.power`.

Humidity, motion, ambient light and separate physical-input roles are deferred
until the current temperature and on/off-output roles have passed the
source-parity gate across all planned sources.

Initial command:

- `set.power` for an LED-like output

Initial reliability scenarios:

- normal command confirmation
- delayed confirmation
- command rejection
- command timeout
- telemetry stops and its observation becomes `stale` while availability remains unchanged
- explicit disconnection changes availability to `offline`
- explicit reconnection restores availability; a later report refreshes the observation

The exact hardware models and UI layout can change. The stable MVP goal is to
exercise the control loop, state model and reliability behavior with a small set
of understandable devices.

Once MQTT is introduced, simulator and device runtime traffic communicates
through a local MQTT broker: the MQTT-backed simulator, ESP32/ESPHome and
standalone MQTT-capable devices. This is the normal local development and
end-to-end route, not only a deployment-like option. Backend-owned source
adapters may use different native topics and payloads, but must produce the
same platform contracts. Native-source and transport doubles are allowed in
backend unit/integration tests as defined by
[Test Suite Boundaries](../decisions/adr-test-suite-boundaries.md); they do not
form an application runtime.

## Main Components

The architecture separates `frontend` for the realtime UI, `backend` for the
realtime API, event processing, read model/projections, command handling and
in-memory storage, `simulator` for simulated devices and scenarios, and
`shared` for platform contracts and adapter-facing message types used across
project boundaries. Backend-owned adapters translate external device sources,
including the simulator, into platform events and commands.

### Event Simulator

Produces realistic device telemetry and state changes before real hardware is available.

Expected responsibilities:

- emit simulator-native device readings and state reports
- consume simulator-native commands for simulated controllable devices
- simulate delays, missed messages and offline periods
- provide repeatable scenarios for testing the UI and event processor

### Event Processor

Consumes platform events and applies backend processing rules.

Expected responsibilities:

- validate event shape
- reject malformed or unsupported events
- route invalid events to a quarantine dataset
- deduplicate events before they update derived state
- apply command lifecycle and confirmation matching rules
- update backend read model/projections from accepted events
- append accepted and quarantined events to backend storage

### Backend Read Model / Projections

Materialized backend views derived from accepted platform events.

Expected responsibilities:

- keep the current room and device state used by realtime reads
- expose active command state, requested state, confirmed reported state,
  availability, health and applicable freshness as derived projections
- keep durable history distinct from current-state projections
- provide UI-friendly read data to the realtime API/BFF without requiring the
  frontend to interpret raw events
- restore the persisted checkpoint at restart without requiring full event sourcing

The local storage decision keeps a latest persisted projection for
restart recovery rather than requiring full event sourcing. It separates
significant facts, raw telemetry and quarantined inputs. It also separates a
non-mutating processor prepare step from durable or volatile runtime commit.
SQLite failure changes top-level platform storage status to `degraded`; live
device projections continue in memory with explicit volatility.

Each valid backend database owns a stable `historyGenerationId`. Storage
sequences and HTTP cursors are scoped to that generation, so explicit
replacement of a corrupt database cannot make an old cursor refer to unrelated
rows after sequences restart.

### Realtime Frontend

Displays the current room state.

Expected responsibilities:

- show the current simulated temperature reading in realtime
- show when the reading was last updated
- show confirmed device state separately from requested state
- show pending, failed and timed-out commands
- surface availability, degraded health and applicable stale observations clearly
- expose bounded user history and selected-device telemetry details
- show `degraded` or `recovering` storage status persistently
  and distinguish volatile observations and commands from durable ones

### Telemetry Storage

Stores events and derived telemetry used for history, debugging and trend analysis.

This is the backend-owned durable history and recovery responsibility.

Expected responsibilities:

- store accepted significant facts as the audit trail and raw telemetry in a
  separate query path
- store quarantined invalid events separately for debugging
- store derived state snapshots or projections for faster reads
- make command history and durable dispatch intents auditable

Significant facts explain what happened, raw telemetry supports detailed
inspection, and derived projections explain what the system currently believes.
The first implementation does not need full event sourcing, but it should keep
enough history to audit commands and debug state changes.

Local storage preserves accepted facts and derived state within the agreed
retention bounds so history and recovery can explain what happened.
The model uses explicit HTTP history reads for telemetry and
recent facts, while SSE remains the snapshot-baseline and live-update channel.
Diagnostics are a technical API and structured-log surface, not a required
Dashboard feature. Durable HTTP reads return service unavailable while storage
is degraded; current realtime state continues over SSE. Recovery writes a
current-state checkpoint and `storage.gap.recorded` rather than backfilling
volatile observations.

### Realtime API / BFF Boundary

Provides the frontend with UI-oriented access to the local backend.

Expected responsibilities:

- provide an initial room snapshot when the frontend connects
- stream state, command and event updates to the frontend over SSE
- accept command requests from the frontend
- read from backend read model/projections and expose UI-friendly derived views
  without making the frontend interpret raw event streams by itself

This boundary is BFF-like because it is shaped for the realtime frontend. In the
target local runtime it belongs to the local Node.js backend together with the
event processor, read model/projections and in-memory storage.

The current realtime read contract sends a `room.snapshot` over
SSE only when the frontend connects or reconnects. It is followed by
named, revision-linked `device.updated`, `commands.updated` and
`platform.updated` messages. A device projection contains current device state,
availability, health and applicable freshness; command updates atomically carry
the complete current device collection plus the global active and terminal
command projections. The history slice adds a bounded live feed,
telemetry samples and a storage watermark on this same connection, while
durable history pages and trends use HTTP. A client reconnects for a new
snapshot when a delta is malformed or has a revision gap.

- `messageType: "room.snapshot"`
- `sentAt`: backend send timestamp
- `payload`: the current `RoomBffSnapshot` (derived from the internal
  `RoomSnapshotProjection`)

Unsupported message types and malformed payloads are not renderable frontend
state. Accepted events and projection changes to availability, health or freshness reach
connected clients through `device.updated`.

The contract extends this one SSE connection rather than
adding a history stream: the BFF snapshot carries a bounded 20-entry `userHistory`
feed (the internal platform projection retains `recentEvents`) and
`platform.storage`, which solely owns the durable-history generation
and watermark.
Existing projection deltas may carry multiple related live feed records or one
telemetry sample at the same revision. `platform.updated` carries storage status
and may carry a transformed `history_gap` user entry. It also follows a durable outcome as a
watermark-only next revision so `platform.storage` remains current. Command projections distinguish intent
durability from lifecycle durability; availability, health and capability
observations carry their own evidence durability.
When recovery restores projection data that a connected degraded client lacks,
one full `commands.updated` reconciliation revision installs devices, commands
and the bounded non-gap feed cache before the next gap-bearing
`platform.updated(available)` revision.
Shared schemas, the BFF and frontend clients must agree on these history and
realtime synchronization rules.
Older facts and telemetry ranges remain explicit HTTP reads; live views merge
them with every buffered SSE-delivered record by stable `recordId` and a pinned
history generation and storage watermark. Raw HTTP sessions are complete through
their bound; user history explicitly marks `retained_evidence_only` because raw
facts cannot prove every historical applied change. Non-feed facts committed
above the bound require an explicit refetch. The Dashboard's user-history
session caches at most 5,000 HTTP entries and 200 live entries, preserving its
reading anchor across updates and same-generation recovery. Its measured virtual
list renders the visible range, five overscan entries per side and at most one
additional reading anchor. Retention tombstones preserve the pinned
view for the cursor's fixed five-minute lifetime; an expired cursor begins a new
session. A changed history generation invalidates the previous pages, cursor
and overlay instead of merging unrelated databases. The client retains the last
known generation through a temporarily unknown degraded state and compares it
with a later snapshot or `platform.updated`. SSE has no replay semantics.

The Dashboard history feed remains unfiltered. Its Filter control opens an
independent modal for static historical search by one device and/or local From/To
days. Both contexts use `GET /room/history/user-history` and the same user-entry
contract; search has its own criteria, pinned pages, cursor and scroll position.
Device/date filters combine with AND over event time. Browser-local inclusive
days become UTC half-open bounds `[from, to)`, with either bound optional.
Unfiltered API queries remain valid for the Dashboard; only the modal requires at least
one criterion before Search. Draft edits do not fetch or change results, Refresh
uses applied criteria, and Clear/close release the search session. Search results
do not merge SSE or automatically rebuild on reconnect, recovery or cursor expiry;
invalidation requires explicit refresh. Read errors preserve a labeled last-known
result view. Search actions never alter the Dashboard session. The
[User History Projection and Virtualized Feed ADR](../decisions/adr-user-history-projection-and-virtualized-feed.md)
owns both contexts and their detailed lifecycle, filter and accessibility rules.

### Device Adapters

Translate external device protocols into the platform event and command model.

Expected responsibilities:

- translate simulator-native messages into platform events for configured simulator sources
- translate platform commands into simulator-native commands for configured controllable devices
- translate hardware-specific protocols into platform events at their source boundary
- send platform commands through the owning physical-device adapter
- report acknowledgements, failures and connection health

Each adapter instance is bound to one configured native device ID and one
platform device ID. It must validate the native ID before creating or replaying
a platform event; messages from other native IDs are rejected at the adapter
boundary. A mapping registry is deferred until an adapter deliberately consumes
a multiplexed source containing multiple native devices.

Adapters belong to the backend side of the boundary. The simulator and later
hardware devices should remain device-like sources of observations and receivers
of device-specific commands.

### MQTT Transport Boundary

Mosquitto is a local transport dependency for every production-like device
source. It routes native MQTT messages only; it does not interpret platform
events, commands or room state. Each MQTT adapter owns validation of its source
topics and payloads, translation into platform facts, and dispatch of platform
commands to native MQTT commands.

If the backend loses its required broker connection, every device available
only through that MQTT source becomes `offline` with the reason
`broker_unavailable`; its commands are blocked. This expresses that the
platform cannot reach the device through its required transport. A backend
reconnect alone does not restore `online`: a later trustworthy device
availability signal is required.

## Local-First Assumption

The platform should work on a local machine or local network first. Cloud services can be added later, but the core control loop should not require them.

This keeps the architecture easier to reason about and makes failures more explicit.

## Development Boundaries

`GET /room` is a debug/read snapshot endpoint, not the frontend fallback path.
Development scenario controls operate the simulator through the normal adapter
and event-processing path rather than mutating frontend state. They are not
product controls and remain disabled unless the development scenario flag is set.
