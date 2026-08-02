# ADR: Command History and Terminal Projections

## Status

Accepted

## Context

The command lifecycle distinguishes active work from terminal outcomes. The
realtime UI must make confirmed, failed and timed-out commands understandable
after they stop being active, without treating requested state as confirmed
device state. The local reference runtime has no durable storage yet.

## Options Considered

- Expose terminal outcomes only through the generic event feed.
- Keep all command projections in `activeCommands`.
- Expose active and terminal command projections separately in each room
  snapshot.
- Add durable command storage before the first command slice.

## Decision

`activeCommands` contains only `accepted` and `pending` command projections.
The backend emits `recentCommands`: a bounded, newest-first in-memory list of
terminal `confirmed`, `failed` and `timed_out` projections. Every
`room.snapshot` includes this collection, using an empty list when there are no
terminal outcomes.

Each terminal projection contains the command and device identifiers, command
type, requested state, request timestamp, its terminal timestamp, and any
applicable dispatch timestamp, reason or message. `failed` requires a non-empty
reason and message; `timed_out` requires a non-empty reason. A command ID cannot appear
in both collections. Every projected command references a device in the same
snapshot; an active command is reflected by that device's `activeCommandId`.

The backend configuration owns the timeout for each supported device type and
command type. A matching report can confirm only a still-pending command after
dispatch. A late matching report updates observed device state and event
history, but leaves a timed-out command terminal.

It does not introduce persistence, a command endpoint or a command runtime.

## Consequences

The frontend receives a UI-oriented command history with the context needed to
explain outcomes. A future dedicated history slice must define an audit-oriented
fact feed separately.
The in-memory limit is intentionally not a durability guarantee; a later
storage decision must define retention and rebuilding semantics.

## Verification

- Shared schemas reject non-terminal `recentCommands`, missing terminal timing
  fields, duplicate command IDs and dangling device references.
- BFF and frontend boundary tests reject malformed snapshots.
- Command-slice tests cover confirmation, explicit failure, timeout and late
  reports without moving a terminal command back to active state.

## Links

- Related architecture document: [Control Loop](../architecture/control-loop.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related decision: [Command Correlation, Confirmation and Concurrency](adr-command-correlation-confirmation-and-concurrency.md)
- Related decision: [JSON Schema Transport Contracts](adr-json-schema-transport-contracts.md)
