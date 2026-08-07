# ADR: Device Command Confirmation and Health Policy

## Status

Accepted

The command-confirmation decision remains accepted. Its freshness and
command-availability-by-health rules are superseded by
[ADR: Device Availability, Health and Observation Freshness](adr-device-availability-and-observation-freshness.md).

## Context

The platform separates requested state from reported state. A user or automation
can ask for a device change, but the UI must not treat that request as device
truth until the platform has evidence that the observable state changed.

The device model needs explicit availability, operational-health,
observation-freshness and command policies. They affect backend processing,
simulator behavior and frontend controls, so they must not be implicit in UI
code.

## Options Considered

- Confirm commands immediately after dispatch.
- Confirm commands after an explicit device acknowledgement.
- Confirm commands after a matching reported state.
- Require both acknowledgement and matching reported state.
- Treat availability, health, freshness and command lifecycle as one state.
- Project availability, health, freshness and command lifecycle independently.

## Decision

Command confirmation uses a matching reported state by default. An
acknowledgement only proves that the command was accepted or received; it does
not prove that the observable device state changed.

For device types that cannot report state reliably, an explicit acknowledgement
may be treated as trusted confirmation. This must be configured per device type
instead of assumed globally.

The event processor accepts a device observation no more than one second ahead
of its injected backend clock. It ignores a report beyond that tolerance as
`future_dated_report`, before deduplication and projection updates. A rejected
report therefore cannot advance `lastObservedAt` or make a stale observation
appear fresh. The same report may be retried after backend time catches up.

Availability, operational health, observation freshness and command availability
are governed by [ADR: Device Availability, Health and Observation Freshness](adr-device-availability-and-observation-freshness.md).
The simulator may emit device-native availability facts and may reject
simulated commands as device behavior, but it does not own UI-facing command
availability or command lifecycle interpretation.

Initial command policies:

| Policy               | Meaning                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `allow`              | Commands may be sent normally.                                           |
| `allow_with_warning` | Commands may be sent, but the UI should show the degraded state clearly. |
| `block`              | Commands should not be sent while this degraded condition is active.     |

## Consequences

Matching reported state makes the UI more honest, but some commands need
command-specific matching rules. For example, exact equality may not work for
brightness, temperature targets or values rounded by device firmware.

Trusted acknowledgement remains available for device types that cannot report
state well, but those exceptions must be documented and tested.

The one-second skew tolerance accommodates the current one-second simulator
cadence while bounding how much a device clock can make an observation appear
fresh.
The bounded diagnostics record explains rejected reports during the local
process lifetime; durable quarantine storage remains future work.

Read-only sensors remain useful while blocking commands. The UI should avoid
presenting controls for them, and backend command handling should reject command
requests that target a read-only role as a first-class failure rather than
dispatching them to an adapter.

## Links

- Related architecture document: [Devices](../architecture/devices.md)
- Related architecture document: [Control Loop](../architecture/control-loop.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Superseding decision: [Device Availability, Health and Observation Freshness](adr-device-availability-and-observation-freshness.md)
