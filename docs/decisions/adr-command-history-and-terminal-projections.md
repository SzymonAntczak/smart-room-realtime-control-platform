# ADR: Command History and Terminal Projections

## Status

Accepted

## Context

The command lifecycle distinguishes active work from terminal outcomes. The
realtime UI must make confirmed, failed and timed-out commands understandable
after they stop being active, without treating requested state as confirmed
device state. A bounded in-memory projection alone is not durable history.

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
command type. A matching report can confirm only a still-pending command with handed-off or
uncertain delivery evidence within its fixed deadline. A late matching report updates observed device state and event
history, but leaves a timed-out command terminal.

Projection ownership does not define the command endpoint or dispatch runtime;
the related command and storage decisions own those responsibilities.

### Storage and durability

The checkpoint persists the newest 20 terminal
`recentCommands` together with active command projections. It preserves command
intent durability and current lifecycle durability independently. A volatile
command active in a committed checkpoint is never redispatched after restart;
before the first snapshot it becomes terminal `failed` with reason
`volatile_command_lost_on_restart`.

Persisted delivery evidence replaces the assumption that every `pending` or terminal command
has `dispatchedAt`. Delivery evidence is discriminated: definite handoff carries
`dispatchedAt` and `deadlineAt`, while uncertain handoff carries
`firstAttemptedAt` and the fixed `deadlineAt` without claiming dispatch. A
matching report may confirm either still-active pending variant under the
command-correlation rules, and the chosen evidence remains on its terminal
projection.

The durable order is descending by the applicable terminal timestamp and then
descending lexicographically by `commandId`. Live insertion, checkpoint
selection and restoration apply the same 20-entry order.

This amendment is accepted with the local storage ADR.

## Consequences

### User-history distinction

The accepted [User History Projection and Virtualized Feed ADR](adr-user-history-projection-and-virtualized-feed.md)
adds a BFF presentation over existing snapshots, publications and paged facts;
it does not change
`activeCommands`, terminal `recentCommands`, command confirmation or their
durability rules. Progress remains at the control. A changed report produces one
observed change, a confirmation without change produces none, and failure or
timeout produces an unsuccessful-attempt entry. A later change cannot reopen
timeout. Full lifecycle facts remain technical audit history. The product
presentation adds no persisted projection or migration.

The frontend receives a UI-oriented command history with the context needed to
explain outcomes. Audit-oriented significant facts remain separate from user-history presentation.
The in-memory limit is not a durability guarantee; the storage decision defines
retention and checkpoint recovery separately.

## Verification

- Shared schemas reject non-terminal `recentCommands`, missing terminal timing
  fields, duplicate command IDs and dangling device references.
- BFF and frontend boundary tests reject malformed snapshots.
- Command-slice tests cover confirmation, explicit failure, timeout and late
  reports without moving a terminal command back to active state.
- Storage tests additionally cover checkpoint restoration of the
  deterministic 20-entry bound, both delivery-evidence variants and
  failure-without-redispatch for an active volatile command.

## Links

- Related architecture document: [Control Loop](../architecture/control-loop.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related decision: [Command Correlation, Confirmation and Concurrency](adr-command-correlation-confirmation-and-concurrency.md)
- Related decision: [JSON Schema Transport Contracts](adr-json-schema-transport-contracts.md)
