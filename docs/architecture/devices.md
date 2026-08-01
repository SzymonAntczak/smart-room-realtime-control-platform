# Devices

## Device Health States

| State      | Meaning                                                                      | UI expectation                                                |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `online`   | Device is connected and reporting within the expected interval.              | Normal controls may be enabled.                               |
| `offline`  | Device is known to be disconnected or unreachable.                           | Controls should be disabled or clearly marked as unavailable. |
| `stale`    | Last known report is older than the expected freshness window.               | Show last known value with a stale warning.                   |
| `degraded` | Device is reachable but reporting errors, partial data or unstable behavior. | Controls may stay available, but the problem must be visible. |

## Command States

| State        | Meaning                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`       | No active command is waiting for completion.                                                                                                            |
| `submitting` | The frontend has sent a command request and is waiting for backend acceptance. This is a UI-side transient state, not a persisted device command state. |
| `accepted`   | Backend accepted and persisted the command, but has not yet dispatched it to an adapter.                                                                |
| `pending`    | Command was dispatched, but not confirmed yet.                                                                                                          |
| `confirmed`  | Device state matches the command, or the device type allows trusted acknowledgement as confirmation.                                                    |
| `failed`     | Device or backend explicitly rejected the command.                                                                                                      |
| `timed_out`  | No confirmation arrived within the allowed time.                                                                                                        |

## State Fields

A useful device state record should separate current observations from user intent.

```json
{
    "deviceId": "led-main",
    "type": "light",
    "health": "online",
    "reportedState": {
        "power": "off"
    },
    "requestedState": {
        "power": "on"
    },
    "command": {
        "id": "cmd-123",
        "state": "pending",
        "requestedAt": "2026-05-21T07:10:00Z"
    },
    "lastSeenAt": "2026-05-21T07:10:01Z"
}
```

The first implementation tracks at most one active command (`accepted` or
`pending`) per device. This
keeps command progress clear in the UI and avoids ambiguous confirmation when
multiple commands target the same device close together.

## Freshness Rules

The exact timeout values can vary by device type, but the model should support these checks:

- a device becomes `stale` when no fresh telemetry arrives inside its freshness window
- a device becomes `offline` when connection loss is explicit or the stale period exceeds an offline threshold
- `degraded` should be used for partial failures instead of hiding the problem behind `online`

`stale` is usually derived by the event processor from time and absence of fresh
events. `offline` can be explicit, for example from a connection-loss event, or
derived after the stale period exceeds the offline threshold.

Only accepted, time-valid reports may advance `lastSeenAt`. A future-dated
report beyond the event contract's one-second clock-skew tolerance is ignored;
it cannot make a device appear fresh. A later report within tolerance is
processed normally and can restore `online` health without a manual reset.
An accepted report whose observation time is not newer than the projected
`lastSeenAt` remains visible in history but cannot regress reported state,
advance freshness or restore `online` health. Recovery requires a newer report
evaluated at the backend processing time.

## Command Availability By Health

Command availability is derived from device capability first, then health.
Read-only telemetry devices such as temperature, humidity, motion and ambient
light sensors do not accept platform commands. Their command policy should be
`block` with reason `read_only_device`, even when the device is otherwise
`online`.

For controllable devices, health provides the default command policy:

| Health     | Default command policy | Meaning                                                       |
| ---------- | ---------------------- | ------------------------------------------------------------- |
| `online`   | `allow`                | Commands may be sent normally.                                |
| `stale`    | `allow_with_warning`   | Commands may be sent only if the UI makes stale data visible. |
| `offline`  | `block`                | Commands should not be sent while the device is unreachable.  |
| `degraded` | Derived from reason    | Availability depends on the degradation reason.               |

## Example Transition

```text
Initial state:
- health: online
- reportedState.power: off
- command.state: idle

User clicks: turn LED on
- requestedState.power: on
- command.state: accepted
- reportedState.power: off

Backend dispatches the command
- command.state: pending

Device reports: LED on
- reportedState.power: on
- command.state: confirmed
```

## Device Model Rules

Command confirmation uses a matching reported state by default. Device types
that cannot report state reliably may opt into trusted acknowledgement
confirmation.

Confirmation matching is configured per command type. The initial `set.power`
command uses exact matching between the requested and reported `power` value.

Freshness thresholds are configured per device type by default. Individual
devices may override these values when there is a specific reason.

A `degraded` device exposes a command policy derived from the degradation
reason.

Read-only devices always expose `block` command availability with reason
`read_only_device`. This is different from being `offline`: an online
temperature sensor can report fresh telemetry while still rejecting commands
because there is no command surface for that role.

Initial command policies:

| Policy               | Meaning                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `allow`              | Commands may be sent normally.                                           |
| `allow_with_warning` | Commands may be sent, but the UI should show the degraded state clearly. |
| `block`              | Commands should not be sent while this degraded condition is active.     |

Decision context and trade-offs are documented in
[ADR: Device Command Confirmation and Health Policy](../decisions/adr-device-command-confirmation-and-health-policy.md).
