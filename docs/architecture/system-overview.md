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

## Initial MVP Scope

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

For Stage 1, these components are architectural roles rather than separate
production services. They should still be separated in the repository:
`frontend` for the realtime UI, `backend` for the realtime API, event
processing, command handling and in-memory storage, `simulator` for simulated
devices and scenarios, and `shared` for platform contracts and adapter-facing
message types used across project boundaries.
Backend-owned adapters translate external device sources, including the
simulator, into platform events and commands.

### Event Simulator

Produces realistic device telemetry and state changes before real hardware is available.

Expected responsibilities:

- emit simulator-native device readings and state reports
- consume simulator-native commands for simulated controllable devices
- simulate delays, missed messages and offline periods
- provide repeatable scenarios for testing the UI and event processor

### Event Processor

Consumes events, validates them and updates derived system state.

Expected responsibilities:

- validate event shape and version
- reject or quarantine malformed events
- derive current room and device state
- keep an append-only event history for important actions
- publish state updates to the frontend

### Realtime Frontend

Displays the current room state and allows the user to send commands.

Expected responsibilities:

- show confirmed device state separately from requested state
- show pending, failed and timed-out commands
- surface offline, stale and degraded devices clearly
- expose event history for troubleshooting

### Telemetry Storage

Stores events and derived telemetry used for history, debugging and trend analysis.

This is a logical storage responsibility. In Stage 1, it is backend-owned
in-memory storage rather than durable persistence.

Expected responsibilities:

- store accepted raw events as the audit trail
- store quarantined invalid events separately for debugging
- store derived state snapshots or projections for faster reads
- make command history auditable

Raw events explain what happened. Derived projections explain what the system
currently believes. The first implementation does not need full event sourcing,
but it should keep enough event history to audit commands and debug state
changes.

Stage 1 storage should still preserve recent accepted events and derived state
long enough for the realtime UI and local demo to explain what happened.

### Realtime API / BFF Boundary

Provides the frontend with UI-oriented access to the local backend.

Expected responsibilities:

- provide an initial room snapshot when the frontend connects
- stream state, command and event updates to the frontend over WebSocket in
  Stage 1
- accept command requests from the frontend
- expose UI-friendly derived views without making the frontend interpret raw
  event streams by itself

This boundary is BFF-like because it is shaped for the realtime frontend. In the
first implementation it belongs to the local Node.js backend together with the
event processor and in-memory storage.

### Device Adapters

Translate external device protocols into the platform event and command model.

Expected responsibilities:

- translate simulator-native messages into platform events in Stage 1
- translate platform commands into simulator-native commands in Stage 1
- translate hardware-specific protocols into platform events in later stages
- send platform commands to physical devices in later stages
- report acknowledgements, failures and connection health

Adapters belong to the backend side of the boundary. The simulator and later
hardware devices should remain device-like sources of observations and receivers
of device-specific commands.

## Local-First Assumption

The platform should work on a local machine or local network first. Cloud services can be added later, but the core control loop should not require them.

This keeps the architecture easier to reason about and makes failures more explicit.
