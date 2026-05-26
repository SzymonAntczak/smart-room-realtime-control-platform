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

| Domain area | Responsibility |
| --- | --- |
| Room state | Current derived view of devices, telemetry, health and pending commands. |
| Devices | Report observable state, receive commands and expose connection health. |
| Events | Facts emitted by devices, simulator, backend or user-facing workflows. |
| Commands | User or automation requests that may later succeed, fail or time out. |
| Telemetry | Time-series readings and historical facts used for debugging and trends. |
| Realtime UI | Human-facing projection of state, command progress and history. |

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

### Event Simulator

Produces realistic device telemetry and state changes before real hardware is available.

Expected responsibilities:

- emit device readings and state reports
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

Persists events and derived telemetry used for history, debugging and trend analysis.

Expected responsibilities:

- store accepted raw events as the audit trail
- store quarantined invalid events separately for debugging
- store derived state snapshots or projections for faster reads
- make command history auditable

Raw events explain what happened. Derived projections explain what the system
currently believes. The first implementation does not need full event sourcing,
but it should keep enough event history to audit commands and debug state
changes.

### Hardware Adapter

Introduced in later stages to connect real devices without changing the core event model.

Expected responsibilities:

- translate device-specific protocols into platform events
- send platform commands to physical devices
- report acknowledgements, failures and connection health

## Local-First Assumption

The platform should work on a local machine or local network first. Cloud services can be added later, but the core control loop should not require them.

This keeps the architecture easier to reason about and makes failures more explicit.
