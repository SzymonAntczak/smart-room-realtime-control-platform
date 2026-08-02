# ADR: Versioned Room Realtime Synchronization

## Status

Accepted

## Context

The first temperature slice streamed a complete `room.snapshot` after every
accepted reading and on a periodic freshness check. That was clear for one
device, but it causes unrelated device cards to receive and process a complete
room projection when only one device changes.

## Decision

The BFF sends a complete version-2 `room.snapshot` only when a WebSocket
connection is established or re-established. The snapshot is the client's
baseline and has revision `0`.

Later changes use named, validated `device.updated` messages. Each carries only
the changed current device projection. Event history is not part of either a
snapshot or a delta until a dedicated history slice defines its storage,
retention and details-view contract. Every delta carries its previous and new
revision. A client must apply only the next contiguous
revision. A malformed delta, an unknown device, or a revision gap preserves
the last valid view and closes the connection; reconnect obtains a new
snapshot baseline.

The BFF emits only version 2. A client continues to accept the frozen version-1
snapshot shape, including its historical event fields, solely for compatibility
with an already-deployed v1 producer; it discards those fields before rendering.

The configured device set is static in this reference slice. A device becomes
stale or offline; it is not removed from the projection. A future dynamic
device set requires explicit add/remove messages and a contract revision.

The backend still evaluates freshness periodically, but publishes only when a
device projection actually changes health. It does not broadcast unchanged
room state.

Development scenarios are discovered lazily per device. A dev-only device-card
control opens a sidebar, which calls `GET /dev/devices/:deviceId/scenarios`.
The sidebar submits a selected action to the same device-scoped resource. The
scenario capability is not included in `room.snapshot` and scenario execution
still reaches the UI solely through the ordinary event, projection and
realtime path.

## Consequences

The frontend owns a small validated projection cache instead of treating every
message as a replacement room. The protocol adds revision and delta tests, but
avoids a generic JSON-patch contract whose semantics would be harder to
validate and explain.

Future command slices add named deltas for active and terminal command
collections before they stream those changes. Device removal requires either a
named removal delta or an explicit static-device rule.

## Verification

- A connection receives one full snapshot and later receives deltas only.
- Snapshots and deltas contain current device values and health, not event history.
- Unchanged health evaluations produce no websocket message.
- A revision gap preserves the latest valid UI and reconnects.
- A device card loads only its own dev scenarios when its control is opened.
