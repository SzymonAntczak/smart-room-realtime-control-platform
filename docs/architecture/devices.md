# Devices

## Availability, Health, Freshness and Commands

A device projection separates three different kinds of fact:

- **availability**: whether supported evidence says the device is reachable;
- **health**: whether supported evidence reports an operational problem;
- **freshness**: whether a specific observed state is still current enough for
  its capability;
- **command lifecycle**: the progress and outcome of a particular request.

None of these fields implies either of the others.

## Device Availability

| State     | Meaning                                                                         | UI expectation                                                |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `online`  | Supported availability evidence says the device is reachable.                   | Show `Online` as the primary device status.                   |
| `offline` | Supported availability evidence says the device is disconnected or unreachable. | Show `Offline`; controllable devices cannot receive commands. |
| `unknown` | No current, trustworthy availability evidence exists.                           | Show `Unknown`; do not imply a connection state.              |

Availability applies to every device. It is derived from explicit,
device-appropriate evidence such as transport connection state, heartbeat,
probe result or a device-native availability report. The age or absence of an
observation must not independently make a device `offline`.

The projection stores `availabilityChangedAt` and, while availability is
`offline`, `availabilityReason`. For example, `broker_unavailable` explains the
transport fact; it is not the same vocabulary as `commandAvailability.reason`.

## Device Health

| State      | Meaning                                                       | UI expectation                                       |
| ---------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| `healthy`  | No known operational problem exists.                          | No additional health warning is required.            |
| `degraded` | The device reports errors, partial data or unstable behavior. | Show the reason separately from availability.        |
| `unknown`  | No current, trustworthy health evidence exists.               | Do not claim that the device is healthy or degraded. |

Health applies to every device but is independent of availability. A
`degraded` device includes a reason and may still be online and useful. Health
changes only from accepted health facts; an old observation does not itself
make a device degraded.

The projection stores `healthChangedAt` and, while health is `degraded`,
`healthReason`.

## Observation Freshness

Freshness applies to an observable capability only when that capability has a
configured freshness policy. The projection exposes it through
`observationStatus`, keyed by capability, so each capability has independent
`freshness` and `lastObservedAt` metadata.

| State     | Meaning                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `fresh`   | The last accepted observation is inside the capability's freshness window.     |
| `stale`   | The last accepted observation exceeded that window.                            |
| `unknown` | No accepted observation exists, or freshness does not apply to the capability. |

Periodic telemetry, such as temperature, requires freshness. Change-driven
actuator state, such as LED power, may retain `lastObservedAt` and optionally
expose freshness when the age of that state matters. An ephemeral button press
is an event, not a persistent observed value, so it has no freshness state.

Only accepted, time-valid reports may advance that capability's `lastObservedAt`.
A future-dated report beyond the event contract's one-second clock-skew
tolerance is ignored; it cannot make an observation appear fresh. An accepted
report whose observation time is not newer than the projected capability
timestamp remains visible in history but cannot regress reported state or
advance freshness.

Under the Stage 4 persistence model, normal startup restores
`lastObservedAt` and reevaluates every configured freshness policy against the
injected startup clock before exposing the first room snapshot. Downtime can
therefore change a restored observation from `fresh` to `stale`; that change is
projection-only and preserves the durability of the underlying evidence.

## Command States

| State        | Meaning                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `idle`       | No active command is waiting for completion.                                                     |
| `submitting` | The frontend sent a request and waits for backend acceptance. This is a UI-side transient state. |
| `accepted`   | Backend accepted and persisted the command, but has not dispatched it to an adapter.             |
| `pending`    | Command was dispatched but not confirmed.                                                        |
| `confirmed`  | Device state matches the command, or the device type allows trusted acknowledgement.             |
| `failed`     | Device or backend explicitly rejected the command.                                               |
| `timed_out`  | No confirmation arrived within the allowed time.                                                 |

The Stage 4 contract adds command durability independently of these
lifecycle states. With platform storage `available`, `accepted` means the
request and durable outbox intent committed before dispatch. With storage
`degraded`, an accepted command is marked `volatile`, is dispatched directly,
is never automatically retried and may disappear on process restart. The API,
command projection and Dashboard must not present a volatile command as
durable. Storage `recovering` temporarily blocks new commands.

The proposed command projection uses `durability` for the request/intent and
`lifecycleDurability` for its current lifecycle state. They can differ after an
adapter handoff whose dispatch transition could not be persisted. Availability,
health and each entry in `observationStatus` likewise carry their own evidence
durability instead of one device-wide flag.

Schema-valid accepted and rejected command outcomes expose both axes; malformed
transport, unknown-device and `platform_recovering` pre-admission errors have no
command outcome and therefore no command ID or durability. For a known device,
an admitted policy or concurrency rejection creates a terminal command failure.
Bootstrap `unknown` device evidence follows the containing projection's durability, while
time-derived freshness changes preserve the durability of the last observation.

The Stage 4 pending and terminal command shapes carry discriminated
delivery evidence. `handed_off` has `dispatchedAt` and `deadlineAt`; `uncertain`
has `firstAttemptedAt` and `deadlineAt` and must not invent `dispatchedAt`. A
later definite handoff changes the evidence variant but keeps the original
deadline established by the first uncertain attempt. `recentCommands` preserves
the same variant so the UI can explain how the lifecycle was timed.

## State Fields

A room snapshot separates current device observations from active and terminal
command projections. A device links to its one active command by
`activeCommandId`; command details live in the top-level `activeCommands` and
`recentCommands` collections.

```json
{
    "devices": [
        {
            "deviceId": "led-main",
            "availability": "online",
            "availabilityChangedAt": "2026-05-21T07:09:59Z",
            "health": "healthy",
            "healthChangedAt": "2026-05-21T07:09:59Z",
            "reportedState": { "power": "off" },
            "observationStatus": {
                "power": {
                    "lastObservedAt": "2026-05-21T07:10:01Z",
                    "freshness": "unknown"
                }
            },
            "activeCommandId": "cmd-123"
        }
    ],
    "activeCommands": [
        {
            "commandId": "cmd-123",
            "deviceId": "led-main",
            "status": "pending",
            "requestedState": { "power": "on" },
            "requestedAt": "2026-05-21T07:10:00Z",
            "dispatchedAt": "2026-05-21T07:10:00Z"
        }
    ],
    "recentCommands": []
}
```

The first implementation tracks at most one active command (`accepted` or
`pending`) per device. This keeps command progress clear in the UI and avoids
ambiguous confirmation when multiple commands target the same device close
together.

## Command Availability

Command availability is derived from device capability first, then device
availability and health. Freshness is not a reachability signal and does not by
itself block a command.

| Capability / availability                                 | Default command policy           | Meaning                                                                  |
| --------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Read-only device                                          | `block` / `read_only_device`     | No platform command surface exists.                                      |
| Controllable and `online`                                 | `allow`                          | Commands may be sent normally.                                           |
| Controllable and `offline`                                | `block` / `device_offline`       | Commands cannot be sent to an unreachable device.                        |
| Controllable and `unknown`                                | `block` / `availability_unknown` | The platform lacks evidence that command delivery is possible.           |
| Controllable, `online`, and `healthy` or `unknown` health | `allow`                          | Availability permits a command and health does not report a known issue. |
| Controllable, `online`, and `degraded`                    | Derived from degradation reason  | The reason chooses `allow`, `allow_with_warning` or `block`.             |

A device-type policy may add a visible warning when a command depends on an old
reported state. That warning describes stale observation data; it does not
change availability to `offline`.

Configured devices bootstrap in the projection with `availability: unknown` and
`health: unknown`. A controllable bootstrap device blocks commands with
`availability_unknown` until an accepted availability fact changes it.

## Example Transition

```text
Initial state:
- availability: online
- health: healthy
- reportedState.power: off
- observationStatus.power.lastObservedAt: 2026-05-21T07:10:01Z
- command.state: idle

User clicks: turn LED on
- activeCommands includes an accepted command with requestedState.power: on
- device.activeCommandId references that command
- reportedState.power remains off

Backend dispatches the command
- activeCommands contains the pending command with dispatchedAt

Device reports: LED on
- reportedState.power: on
- observationStatus.power.lastObservedAt advances
- activeCommands no longer contains the command
- recentCommands contains the confirmed command
```

## Device Model Rules

Command confirmation uses a matching reported state by default. Device types
that cannot report state reliably may opt into trusted acknowledgement
confirmation.

Confirmation matching is configured per command type. The initial `set.power`
command uses exact matching between the requested and reported `power` value.
That match records that the requested observable state was reached; it does not
attribute its cause when a physical device input can change the same state.
Physical state reports always update observed state, including when a frontend
command is active.

Freshness windows are configured per observable capability by default.
Individual devices may override them when there is a specific reason.

Health reasons are configured per device type. A `degraded` health reason
derives the command policy for a controllable online device; it never changes
availability.

Availability and health transitions are ordered independently by `occurredAt`.
The processor applies a transition only when its timestamp is later than the
corresponding `availabilityChangedAt` or `healthChangedAt`; an equal or older
transition remains diagnosable but cannot regress current state. The event's
previous-value field is descriptive, not a transition precondition.

The bootstrap `unknown` values are projection baselines, not accepted device
facts. The first availability or health fact may therefore use the same
timestamp as the baseline and establishes that dimension's evidence. Every
subsequent transition follows the strictly-later ordering rule above.

An availability change blocks only new commands. An existing `accepted` or
`pending` command remains active until the adapter emits `command.failed` or the
normal timeout expires; the availability change must not silently rewrite it.

Platform storage availability is also independent of device availability,
health and observation freshness. A database outage does not make a device
offline and does not stale a fresh observation. In the Stage 4 model,
it changes top-level platform status and the durability of new work. An active
durable command blocks a new volatile command for the same device; recovery
waits for any conflicting active volatile command to become terminal before it
resumes durable outbox work.

The Stage 4 checkpoint includes active commands, the newest 20 terminal
`recentCommands` and the bounded `recentEvents` projection cache. A checkpointed
active volatile command is never redispatched after restart; before the first
snapshot it becomes `failed` with reason `volatile_command_lost_on_restart`.
Restored volatile feed cache entries remain volatile and do not become durable
HTTP history.

Checkpoint persistence likewise does not promote volatile device evidence or
command intent/lifecycle markers. Only a later durable fact that establishes a
specific dimension changes that dimension's durability.

The last 20 `recentCommands` are a projection cache independent of 30-day fact
retention. An old terminal command remains until newer terminal commands evict
it; its timestamp keeps that age explicit.

A later durable observation that exactly matches a volatile dimension's value
and timestamp may upgrade only its evidence durability. It does not create feed
noise when the report otherwise changes no state. Older or conflicting evidence
cannot perform that upgrade.

Initial command policies:

| Policy               | Meaning                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| `allow`              | Commands may be sent normally.                                                 |
| `allow_with_warning` | Commands may be sent, with an explicit warning about the applicable condition. |
| `block`              | Commands should not be sent while this condition is active.                    |

Decision context and trade-offs are documented in
[ADR: Device Availability, Health and Observation Freshness](../decisions/adr-device-availability-and-observation-freshness.md)
and [ADR: Device Command Confirmation and Health Policy](../decisions/adr-device-command-confirmation-and-health-policy.md).
Physical-actuation behavior is documented in
[ADR: External Actuation and Command Outcomes](../decisions/adr-external-actuation-and-command-outcomes.md).
