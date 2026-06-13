# Backend Platform

The platform folder contains backend code that belongs to the stable Smart Room
control model rather than to one external source.

## Contents

- `event-processing/` validates platform events, deduplicates them and applies
  event-processing rules before state changes are accepted.
- `read-model/` owns backend projections derived from accepted platform events.
  The realtime API/BFF reads these projections instead of interpreting raw
  device-native messages.
- `ports/` contains small interfaces shared by adapters and platform modules,
  such as event sinks and ID generators.

Adapters for simulator, Home Assistant, MQTT or hardware should live outside
`platform/` and translate their source-specific messages into platform events.

Detailed behavior rules live in the architecture docs, accepted ADRs and
`backend/AGENTS.md`.
