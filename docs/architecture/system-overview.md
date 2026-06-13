# System Overview

## Goal

Build a local-first realtime control platform for a smart room.

The system should be small enough to build incrementally, but realistic enough to exercise the hard parts of IoT-style systems:

- event-driven communication
- realtime user interface updates
- telemetry and event history
- simulated devices first, minimal real hardware later
- explicit handling of offline, stale and degraded devices

## Domain Boundaries

The architecture is organized around the main domain concepts, not around implementation layers.

| Domain area | Responsibility                                                                 |
| ----------- | ------------------------------------------------------------------------------ |
| Room state  | Current derived view of devices, telemetry, health and pending commands.       |
| Devices     | Report observable state, receive commands and expose connection health.        |
| Events      | Facts emitted by backend adapters, backend workflows or user-facing workflows. |
| Commands    | User or automation requests that may later succeed, fail or time out.          |
| Telemetry   | Time-series readings and historical facts used for debugging and trends.       |
| Realtime UI | Human-facing projection of state, command progress and history.                |

## Incremental Read Path

The architecture can be built in smaller slices before the full smart-room
model exists. A minimal read path may start as a read-only realtime view of one
simulated temperature sensor before backend transport, command handling and
storage are introduced.

A minimal read path should show:

- the sensor name
- the current temperature reading
- the reading unit
- the last reading time
- that the value is coming from simulated realtime updates

This early slice does not define the long-term runtime topology. Backend
adapters, event processing, event history, stale/offline handling and command
flows are added as later slices while preserving the same platform model.

## Target MVP Scope

The first useful system slice focuses on a small smart-room model.

Initial device roles:

- temperature sensor
- humidity sensor
- motion sensor
- ambient light sensor
- LED output
- physical LED button

Initial command:

- `set.power` for an LED-like output

Initial reliability scenarios:

- normal command confirmation
- delayed confirmation
- command rejection
- command timeout
- telemetry stops and the device becomes `stale`
- stale device becomes `offline`
- device reconnects and reports fresh state

The exact hardware models and UI layout can change. The stable MVP goal is to
exercise the control loop, state model and reliability behavior with a small set
of understandable devices.

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

- validate event shape and version
- reject malformed or unsupported events
- route invalid events to a quarantine stream when the storage/quarantine slice
  exists
- deduplicate events before they update derived state
- apply command lifecycle and confirmation matching rules
- update backend read model/projections from accepted events
- append accepted and quarantined events to backend storage when those slices
  exist

### Backend Read Model / Projections

Materialized backend views derived from accepted platform events.

Expected responsibilities:

- keep the current room and device state used by realtime reads
- expose active command state, requested state, confirmed reported state and
  device health as derived projections
- keep recent event history for UI troubleshooting and audit-oriented views
- provide UI-friendly read data to the realtime API/BFF without requiring the
  frontend to interpret raw events
- remain rebuildable from accepted events when the storage slice supports that

### Realtime Frontend

Displays the current room state.

Expected responsibilities:

- show the current simulated temperature reading in realtime
- show when the reading was last updated
- show confirmed device state separately from requested state
- show pending, failed and timed-out commands
- surface offline, stale and degraded devices clearly
- expose event history for troubleshooting

### Telemetry Storage

Stores events and derived telemetry used for history, debugging and trend analysis.

This is a logical storage responsibility for a backend-backed slice.

Expected responsibilities:

- store accepted raw events as the audit trail
- store quarantined invalid events separately for debugging
- store derived state snapshots or projections for faster reads
- make command history auditable

Raw events explain what happened. Derived projections explain what the system
currently believes. The first implementation does not need full event sourcing,
but it should keep enough event history to audit commands and debug state
changes.

A later local storage slice should preserve recent accepted events and derived
state long enough for the realtime UI and local demo to explain what happened.

### Realtime API / BFF Boundary

Provides the frontend with UI-oriented access to the local backend.

Expected responsibilities:

- provide an initial room snapshot when the frontend connects
- stream state, command and event updates to the frontend over WebSocket in a
  later backend-backed realtime slice
- accept command requests from the frontend
- read from backend read model/projections and expose UI-friendly derived views
  without making the frontend interpret raw event streams by itself

This boundary is BFF-like because it is shaped for the realtime frontend. In the
target local runtime it belongs to the local Node.js backend together with the
event processor, read model/projections and in-memory storage.

### Device Adapters

Translate external device protocols into the platform event and command model.

Expected responsibilities:

- translate simulator-native messages into platform events in a later simulator
  integration slice
- translate platform commands into simulator-native commands in a later control
  slice
- translate hardware-specific protocols into platform events in later stages
- send platform commands to physical devices in later stages
- report acknowledgements, failures and connection health

Adapters belong to the backend side of the boundary. The simulator and later
hardware devices should remain device-like sources of observations and receivers
of device-specific commands.

## Local-First Assumption

The platform should work on a local machine or local network first. Cloud services can be added later, but the core control loop should not require them.

This keeps the architecture easier to reason about and makes failures more explicit.

## Current Implementation Status

The current backend-backed slice starts with the read-only telemetry path for a
simulated temperature sensor. It includes a simulator adapter, event processor
and read-model projection for `telemetry.reading.recorded` events.

Command lifecycle processing, confirmation matching, command projections,
backend realtime transport, persistence and quarantine storage remain target
responsibilities for later slices. Until command lifecycle events are
implemented, the backend read model may expose empty command collections.
