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

### Stage 4 amendment

The Stage 4 checkpoint persists the newest 20 terminal
`recentCommands` together with active command projections. It preserves command
intent durability and current lifecycle durability independently. A volatile
command active in a committed checkpoint is never redispatched after restart;
before the first snapshot it becomes terminal `failed` with reason
`volatile_command_lost_on_restart`.

Stage 4 also replaces the assumption that every `pending` or terminal command
has `dispatchedAt`. Delivery evidence is discriminated: definite handoff carries
`dispatchedAt` and `deadlineAt`, while uncertain handoff carries
`firstAttemptedAt` and the fixed `deadlineAt` without claiming dispatch. A
matching report may confirm either still-active pending variant under the
command-correlation rules, and the chosen evidence remains on its terminal
projection.

The durable order is descending by the applicable terminal timestamp and then
descending lexicographically by `commandId`. Live insertion, checkpoint
selection and restoration apply the same 20-entry order.

This amendment is accepted with the Stage 4 storage ADR.

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
- Stage 4 tests additionally cover checkpoint restoration of the
  deterministic 20-entry bound, both delivery-evidence variants and
  failure-without-redispatch for an active volatile command.

## Links

- Related architecture document: [Control Loop](../architecture/control-loop.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related decision: [Command Correlation, Confirmation and Concurrency](adr-command-correlation-confirmation-and-concurrency.md)
- Related decision: [JSON Schema Transport Contracts](adr-json-schema-transport-contracts.md)
