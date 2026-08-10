# ADR: Room Realtime Synchronization

## Status

Accepted

## Context

The first temperature slice streamed a complete `room.snapshot` after every
accepted reading and on a periodic freshness check. That was clear for one
device, but it causes unrelated device cards to receive and process a complete
room projection when only one device changes.

The repository is still in deep local development. Its simulator, backend and
frontend evolve together, so retaining multiple wire shapes would hide drift
and make every contract change more expensive to validate. Earlier realtime
compatibility rules are recorded in the superseded ADR below.

Before a production deployment, the project must define and implement a
versioning strategy appropriate for independently deployed producers and
consumers. That production-readiness work is outside the current local slice.

## Options Considered

- Keep compatibility with retired wire shapes during development.
- Introduce version markers in every current development message.
- Use one strict current contract during development and add a deliberate
  versioning strategy before production deployment.

## Decision

The BFF sends a complete `room.snapshot` only when an SSE
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

The BFF and clients support one current realtime contract. They reject messages
with removed history fields, retired contract fields or undocumented shapes before those
messages reach renderable state.

The platform uses one current event envelope for the same development period.
Event consumers validate required fields and payloads, while ignoring additional
envelope fields that do not affect current processing.

Before production deployment, introduce a documented strategy for evolving
independently deployed contracts. Until then, no contract carries a version
marker and no compatibility path is supported.

The configured device set is static in this reference slice. A device may have
a stale observation or become explicitly offline; it is not removed from the
projection. A future dynamic device set requires explicit add/remove messages
and a contract revision.

The backend still evaluates freshness periodically, but publishes only when a
device projection actually changes freshness. Availability changes require
explicit availability evidence. It does not broadcast unchanged room state.

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

Command slices use a named `commands.updated` delta for command lifecycle
changes. Its payload contains the affected device together with the complete
`activeCommands` and `recentCommands` collections, applied atomically at the
next contiguous revision. In the initial LED slice, all command projections
refer to that affected controllable device; this lets the boundary validate its
`activeCommandId` relation without relying on a partially applied client cache.
Device removal requires either a named removal delta or an explicit static-device rule.

This makes development-time breaking changes explicit and inexpensive, but it
means an older local producer or consumer must be updated together with the
rest of the repository. Production deployment is blocked until the separate
versioning decision and its rollout plan are complete.

## Verification

- A connection receives one full snapshot and later receives deltas only.
- Snapshots and deltas contain current device values and health, not event history.
- Unchanged health evaluations produce no SSE message.
- A revision gap preserves the latest valid UI and reconnects.
- Retired or undocumented fields in snapshots and deltas are rejected before
  they update renderable UI state.
- A device card loads only its own dev scenarios when its control is opened.
- Command deltas reject a non-contiguous revision, a dangling command-device
  reference, duplicate command IDs, overlapping active commands, or a mismatch
  between the affected device's `activeCommandId` and `activeCommands`.
