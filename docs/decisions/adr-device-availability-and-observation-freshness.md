# ADR: Device Availability, Health and Observation Freshness

## Status

Accepted

## Context

The first temperature slice used one `health` field for transport reachability,
elapsed time since a report, partial device failures and command availability.
That model makes a missing or infrequent telemetry report look like evidence
that a device is disconnected. It is misleading for sparse sensors and
actuators that report state only after a change.

The UI must tell the user what is known without converting an absence of
observation into a claim about device connectivity. Command progress is already
an independent lifecycle and must remain so.

## Options Considered

- Keep `online`, `stale`, `offline` and `degraded` in one `health` field.
- Infer device availability from elapsed time since the last observation.
- Project availability, operational health, observation freshness and command
  lifecycle as separate dimensions.

## Decision

Every device projection exposes `availability` with one of these values:

| Availability | Meaning                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| `online`     | A supported availability signal says the device is reachable.                   |
| `offline`    | A supported availability signal says the device is disconnected or unreachable. |
| `unknown`    | The platform has no current, trustworthy availability evidence.                 |

Availability is a device-wide fact. It may be derived only from explicit,
device-appropriate evidence such as a transport connection or disconnection,
heartbeat, successful or failed probe, or a device-native availability report.
The absence or age of telemetry or state reports must never, by itself, change
availability to `offline`.

Each projection retains `availabilityChangedAt` and, while availability is
`offline`, a machine-readable `availabilityReason`. The reason explains the
availability fact, for example `broker_unavailable`; it is distinct from the
derived `commandAvailability.reason` such as `device_offline`.

Every device projection also exposes operational `health`:

| Health     | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| `healthy`  | The platform has no known operational problem for the device.         |
| `degraded` | The device reports errors, partial data or unstable behavior.         |
| `unknown`  | The platform has no current, trustworthy operational-health evidence. |

Health is not a reachability signal and must not reuse `online` or `offline`.
It changes only through accepted operational-health facts, such as a
device-native error, partial-data report or recovery report. A `degraded`
health projection includes a machine-readable reason. It may coexist with any
availability and freshness value; for example, a device can be `online`,
`degraded` and have a `fresh` temperature observation.

Each projection retains `healthChangedAt` and, while health is `degraded`, a
machine-readable `healthReason`.

Availability and health transitions are monotonic per device dimension. The
event processor changes a dimension only when an accepted transition has an
`occurredAt` later than its corresponding projected changed-at timestamp. A
transition with an equal or earlier timestamp remains visible in history and
diagnostics but cannot regress the projection. `previousAvailability` and
`previousHealth` describe the producer's fact; they are not a precondition for
applying a newer transition because a dropped earlier transition must not leave
the projection stuck.

Bootstrap `unknown` is a projection baseline, not accepted availability or
health evidence. The first fact for either dimension may use the same timestamp
as its baseline; only subsequent equal or earlier facts are non-applying.

Freshness describes the confidence in an observed state, not reachability. A
capability that has a configured freshness policy exposes an entry in
`observationStatus`, keyed by capability. Each entry contains `freshness` as
`fresh`, `stale` or `unknown`, together with `lastObservedAt` when there is an
accepted observation. `stale` means that the observation exceeded its expected
freshness window. `unknown` means that no accepted observation exists or that
the capability has no applicable freshness policy.

Freshness is configured per observable capability, rather than assumed for
every device. It is required for periodic telemetry such as temperature. It is
optional for actuator state: an LED may retain `lastObservedAt` so the UI can
say when `power` was last confirmed, but need not show a stale badge when it
only reports after a change. Ephemeral input events, such as a button press,
do not have a persistent observed value and therefore do not receive freshness.

Command lifecycle remains independent. A pending, failed or timed-out command
describes one request, not availability, health or freshness. Command
availability is derived first from device capability, then from availability
and, when applicable, from health:

| Capability / availability                             | Default command policy              |
| ----------------------------------------------------- | ----------------------------------- |
| Read-only capability                                  | `block` with `read_only_device`     |
| Controllable and `online`                             | `allow`                             |
| Controllable and `offline`                            | `block` with `device_offline`       |
| Controllable and `unknown`                            | `block` with `availability_unknown` |
| Controllable, `online`, `healthy` or `unknown` health | `allow`                             |
| Controllable, `online`, `degraded`                    | Derived from the degradation reason |

Freshness alone does not block a command or alter availability. A device-type
policy may add an explicit warning when acting on an old reported state is
meaningful; that warning must name the stale observation, not call the device
offline. A degradation reason may select `allow`, `allow_with_warning` or
`block`, but it must not relabel the device as offline.

The UI uses availability as the primary device-card status. When applicable,
it separately displays a degraded-health warning, stale observation data and the
lifecycle of an active or recent command.

Configured devices exist in the room projection before their first device fact.
They bootstrap with `availability: unknown` and `health: unknown`; a
controllable device therefore exposes `block` with `availability_unknown` until
availability evidence is accepted.

### Stage 4 amendment

The Stage 4 storage decision adds an independent evidence
`durability` discriminator to availability, health and every applicable
`observationStatus` entry. A checkpoint may therefore restore a projection that
mixes durable and volatile evidence without promoting outage facts into durable
history. Bootstrap `unknown` is durable after an available startup transaction
and volatile after degraded startup.

Normal startup reevaluates every configured freshness policy against the
injected startup clock and restored `lastObservedAt` before exposing the first
room snapshot. Elapsed downtime may change `fresh` to `stale`, but this is a
projection-only checkpoint update: it creates no accepted fact, feed record,
deduplication identity, storage sequence or watermark advance and preserves the
underlying observation evidence durability.

This amendment is accepted with the Stage 4 storage ADR.

An availability change affects only new command admission. An already accepted
or pending command remains active until an explicit `command.failed` fact or its
normal timeout. A later offline state must not silently rewrite that command's
lifecycle outcome.

## Consequences

The platform avoids false offline claims for infrequent sensors and
change-driven actuators. It also requires adapters and simulators to model a
real availability signal before they can assert `online` or `offline`; until
then the honest value is `unknown`.

Snapshots become more expressive and consumers need to render more than one
status when relevant. The legacy device-level `lastSeenAt` is replaced by
per-capability `observationStatus.*.lastObservedAt`, because an observation
must not be treated as availability evidence and capabilities can age
independently.

The existing combined `health` vocabulary and stale-to-offline escalation are
retired from the target model. The command-confirmation rules in the earlier ADR
remain accepted; its freshness and command-availability-by-health portions are
superseded by this decision.

## Verification

- Contract tests reject a projection whose `availability`, `health` or
  `freshness` is outside its vocabulary; they cover reasons and independent
  capability freshness entries.
- Projection tests prove that elapsed telemetry time changes only `freshness`,
  while explicit availability evidence changes only `availability`; they cover
  bootstrap `unknown`, delayed transitions, equal timestamps and offline during
  an active command.
- Stage 4 tests additionally prove independent evidence durability and
  startup freshness reevaluation before the first snapshot without history or
  watermark creation.
- Simulator scenarios cover a sparse-but-online sensor, an explicit offline
  device with retained last observation, a degraded-but-online device, and
  recovery through explicit availability and health evidence.
- UI tests show availability, degraded health, stale observation data and
  command outcomes as separate messages.

## Links

- Related architecture document: [Devices](../architecture/devices.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related architecture document: [Reliability and Testing](../architecture/reliability-and-testing.md)
- Partially supersedes: [Device Command Confirmation and Health Policy](adr-device-command-confirmation-and-health-policy.md)
