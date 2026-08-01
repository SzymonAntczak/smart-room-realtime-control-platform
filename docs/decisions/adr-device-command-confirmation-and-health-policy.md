# ADR: Device Command Confirmation and Health Policy

## Status

Accepted

## Context

The platform separates requested state from reported state. A user or automation
can ask for a device change, but the UI must not treat that request as device
truth until the platform has evidence that the observable state changed.

The device model also needs consistent rules for stale detection and degraded
devices. These rules affect backend processing, simulator behavior and frontend
controls, so they should be explicit rather than implicit in UI code.

## Options Considered

- Confirm commands immediately after dispatch.
- Confirm commands after an explicit device acknowledgement.
- Confirm commands after a matching reported state.
- Require both acknowledgement and matching reported state.
- Configure freshness thresholds only globally.
- Configure freshness thresholds per device type.
- Configure freshness thresholds per individual device.
- Always allow commands for degraded devices.
- Always block commands for degraded devices.
- Derive command availability from the degradation reason.
- Allow stale devices with warning but block offline devices.

## Decision

Command confirmation uses a matching reported state by default. An
acknowledgement only proves that the command was accepted or received; it does
not prove that the observable device state changed.

For device types that cannot report state reliably, an explicit acknowledgement
may be treated as trusted confirmation. This must be configured per device type
instead of assumed globally.

Freshness thresholds are configured per device type by default. Individual
devices may override these values when there is a specific reason, such as
network quality, battery behavior or firmware limitations.

The event processor accepts a device observation no more than one second ahead
of its injected backend clock. It ignores a report beyond that tolerance as
`future_dated_report`, before deduplication and projection updates. A rejected
report therefore cannot advance `lastSeenAt` or prevent stale/offline health;
the same report may be retried after backend time catches up, and a subsequent
time-valid report restores normal freshness behavior.

A `degraded` device accepts commands only when its command policy allows it. The
backend derives platform command availability from the degradation reason and
exposes it with the device state. The simulator may emit simulated degradation
facts and may reject simulated commands as device behavior, but it does not own
UI-facing command availability or command lifecycle interpretation.

Command availability is derived from device capability before health.
Read-only telemetry devices such as temperature, humidity, motion and ambient
light sensors do not accept platform commands. The backend exposes them with
`block` command availability and reason `read_only_device`, even when their
health is `online`.

For controllable devices, default command availability is derived from health:

- `online`: allow commands
- `stale`: allow commands with a visible warning
- `offline`: block commands
- `degraded`: derive command policy from the degradation reason

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

Per-device freshness overrides should remain exceptions. If they become common,
similar devices may appear to use inconsistent stale or offline behavior, making
debugging harder.

The one-second skew tolerance accommodates the current one-second simulator
cadence while bounding how much a device clock can extend apparent freshness.
The bounded diagnostics record explains rejected reports during the local
process lifetime; durable quarantine storage remains future work.

Deriving command availability from degraded reasons is more flexible than always
allowing or always blocking commands, but it requires a small shared vocabulary
for degradation reasons and command policies.

Read-only sensors can remain healthy and useful while still blocking commands.
The UI should avoid presenting controls for those devices, and backend command
handling should reject command requests that target a read-only role as a
first-class failure rather than dispatching them to an adapter.

## Links

- Related architecture document: [Devices](../architecture/devices.md)
- Related architecture document: [Control Loop](../architecture/control-loop.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
