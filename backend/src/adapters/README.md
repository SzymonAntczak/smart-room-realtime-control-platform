# Backend Adapters

Adapters translate source-specific messages into platform events. They are the
boundary between simulator, hardware or external system shapes and the backend
platform contract. Every adapter emits all of its platform events through one
required sink, so a composition cannot silently omit availability or health.

Simulator-native facts carry a source-generated `messageId`. An adapter derives
the platform `eventId` from its source, configured native device ID and that
identity, so it is globally unique while a repeated delivery of the same native
fact remains deduplicable without an adapter-local replay cache.

## Contents

- `simulator/` contains temperature and LED adapters for simulator-native
  messages.

The simulator adapters provide the current read-path and command/confirmation
translation examples. Detailed adapter rules live in `backend/AGENTS.md` and
the architecture docs.

An adapter may opt into automatic durable-outbox retry only when its receiving
source persists an equivalent source-owned command receipt keyed by the stable
`commandId`. The simulator LED route declares this capability through its
receipt port. Volatile commands and future sources without durable receipts use
no automatic retry.
