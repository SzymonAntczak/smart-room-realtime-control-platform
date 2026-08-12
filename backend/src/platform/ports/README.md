# Platform Ports

Ports are small interfaces that let adapters and platform modules connect
without making either side own the other's runtime details.

## Contents

- `PlatformEventSink` receives platform events emitted by adapters.
- `EventIdGenerator` provides deterministic or runtime-generated event IDs.
- `SetPowerCommandDispatcher` translates a platform `set.power` command at an adapter boundary.
