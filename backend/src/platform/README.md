# Backend Platform

The platform folder contains backend code that belongs to the stable Smart Room
control model rather than to one external source.

## Contents

- `event-processing/` validates platform events, deduplicates them and applies
  event-processing rules before state changes are accepted.
- `diagnostics/` reads retained quarantine metadata for technical inspection
  through the durable diagnostics API.
- `read-model/` owns backend projections derived from accepted platform events.
  The realtime API/BFF reads these projections instead of interpreting raw
  device-native messages.
- `command-processing/` owns platform command admission and dispatch rules
  before a source-specific adapter receives a command.
- `ports/` contains small interfaces shared by adapters and platform modules,
  such as event sinks and ID generators.
- `room/` owns room-level orchestration boundaries: the engine, its room and
  storage-session state owners, serialized input, event-record commits and
  realtime publication. The engine keeps the single ordered input path and
  recovery cutover; individual policies live with their platform domains.

The runtime facade preserves the public temperature-room API and composes the
platform engine with concrete sources. Simulator device definitions, timing,
scenarios and receipt persistence live in `runtime/simulator/`; platform room
modules do not import that composition, the API/BFF or source adapters.

Adapters for simulator, Home Assistant, MQTT or hardware should live outside
`platform/` and translate their source-specific messages into platform events.

Detailed behavior rules live in the architecture docs, accepted ADRs and
`backend/AGENTS.md`.
