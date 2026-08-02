# ADR: Command Correlation, Confirmation and Concurrency

## Status

Accepted

## Context

The platform separates command intent from confirmed device state. This makes
the UI honest, but it also means the event processor needs clear rules for
connecting a user request, command lifecycle events and later device reports.

Without explicit correlation rules, a device state report may accidentally be
treated as confirmation for the wrong command. This becomes especially risky
when commands are retried, delayed, timed out or sent close together.

The initial scope also needs a simple policy for concurrent commands. A single
device receiving multiple overlapping commands is harder to reason about than a
single active command, especially before real hardware behavior is known.

## Options Considered

- Treat any matching device state report as confirmation for the latest command.
- Require command lifecycle events to carry the `commandId`.
- Add a broader `correlationId` and `causationId` model from the beginning.
- Confirm commands with generic equality between requested and reported state.
- Configure confirmation matching per command type.
- Allow multiple active commands per device.
- Queue commands per device.
- Reject or block a new command while another command for the same device is
  active.

## Decision

Command lifecycle events must carry the `commandId` they describe.

The initial model uses `commandId` as the primary correlation field. A broader
`correlationId` or `causationId` can be added later when multi-step workflows,
automation chains or cloud synchronization make that extra tracing useful.

Device state reports do not need to carry `commandId` by default. They remain
observable device facts. The event processor confirms a pending command only
when a fresh reported state matches that command's confirmation rule.

If a matching device report arrives after the command has timed out, the report
updates the observed device state but does not change the timed-out command into
`confirmed`.

Confirmation matching is configured per `commandType`. The first supported
matcher is exact matching for `set.power`, where the requested power state must
equal the reported power state. Future command types may use tolerance windows,
partial matching or trusted acknowledgement when documented by the device
model.

For the first implementation, each device may have at most one active command:
`accepted` after backend acceptance and before adapter dispatch, or `pending`
after dispatch and before completion. If a new command targets a device that
already has an active command, the backend rejects it with a first-class command
failure instead of silently
overwriting, merging or queueing it.

## Consequences

The event history can answer which command was requested, dispatched, confirmed,
failed or timed out without relying on event ordering alone.

Keeping device reports independent from command IDs preserves the distinction
between observed state and command lifecycle. A device can report state even
when no command is active.

Per-command confirmation rules add a small amount of configuration work, but
they avoid hard-coding equality rules that will fail for dimmers, thermostats
or devices that report rounded values.

Blocking overlapping commands keeps the first control loop simple and makes the
UI easier to explain. A later extension can introduce queues or superseding
commands when there is a concrete workflow that needs them.

Rejecting an overlapping command should still be recorded as an auditable
command lifecycle fact so the user can understand why the request did not run.

## Links

- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related architecture document: [Control Loop](../architecture/control-loop.md)
- Related architecture document: [Devices](../architecture/devices.md)
- Related decision: [ADR: Device Command Confirmation and Health Policy](adr-device-command-confirmation-and-health-policy.md)
