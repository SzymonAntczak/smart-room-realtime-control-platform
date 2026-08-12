# Events and Commands

## Contract Principles

Events are facts that already happened. Commands are requests for something to happen.

This distinction keeps the system auditable and prevents the UI from treating user intent as device truth.

Commands are not events. A command represents intent, for example `set.power`.
The system records facts about that command as events, for example `command.requested`,
`command.dispatched` and `command.failed`.

In other words, the command says "please do this". Command-related events say
"this part of the command lifecycle happened".

## Common Event Envelope

Every stored event should include a stable envelope.

```json
{
    "eventId": "evt-123",
    "eventType": "device.state.reported",
    "occurredAt": "2026-05-21T07:10:01Z",
    "source": "simulator-adapter",
    "deviceId": "led-main",
    "payload": {}
}
```

Required envelope fields:

- `eventId`: unique event identifier for deduplication
- `eventType`: stable event name
- `occurredAt`: time when the fact happened
- `source`: producer name, for example `simulator-adapter`, `hardware-adapter`
  or `backend`
- `payload`: event-specific data

Optional envelope fields:

- `deviceId`: related device when applicable
- `commandId`: related command for command lifecycle events

Command lifecycle events must include the `commandId` they describe. Device
state reports do not include `commandId` by default; they are observed device
facts and may confirm a pending command only through the processor's matching
rules. A physical device input is one such observed source: its report updates
device state and a matching pending command records an outcome, not proof that
the command caused the change.

Timestamps may arrive as ISO-8601 UTC values or with an explicit UTC offset.
The contract boundary normalizes accepted values to canonical UTC (`Z`) before
they are stored or used by projections and diagnostics.

Device observations are also checked against the backend processing clock. A
report may be at most 1 second ahead of that clock; a report further in the
future is ignored as `future_dated_report`. Ignored reports do not update the
current projection, event history or deduplication state, but their metadata is
available through development diagnostics. This prevents a bad device clock
from advancing `lastObservedAt` and making an old observation appear fresh.

Availability and health transitions are ordered independently by their envelope
`occurredAt`. The event processor updates the corresponding projection only
when a transition is later than `availabilityChangedAt` or `healthChangedAt`.
An equal or older transition is retained for history and diagnostics but does
not regress current state. Its `previousAvailability` or `previousHealth` is a
producer-reported fact, not a precondition for a newer transition.

The projection's bootstrap `unknown` timestamp is a baseline rather than a
device fact. Its first availability or health fact may have the same timestamp;
once evidence exists, equal or older transitions remain non-applying.

## Initial Event Types

| Event type                    | Purpose                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| `device.state.reported`       | Device reported its current observable state.                         |
| `device.availability.changed` | Device availability changed between `online`, `offline` or `unknown`. |
| `device.health.changed`       | Device health changed between `healthy`, `degraded` or `unknown`.     |
| `telemetry.reading.recorded`  | Sensor reading was recorded.                                          |
| `command.requested`           | User or automation request was accepted as a command.                 |
| `command.dispatched`          | Backend dispatched a platform command to an adapter.                  |
| `command.failed`              | Command failure was detected explicitly.                              |
| `command.timed_out`           | Command did not complete within the allowed time.                     |

## Initial Payload Shapes

The first implementation should keep payloads small and explicit.

### `device.state.reported`

```json
{
    "reportedState": {
        "power": "on"
    },
    "reportedAt": "2026-05-21T07:10:01Z"
}
```

### `device.availability.changed`

```json
{
    "previousAvailability": "online",
    "availability": "offline",
    "reason": "transport_disconnected"
}
```

### `device.health.changed`

```json
{
    "previousHealth": "healthy",
    "health": "degraded",
    "reason": "partial_state_report"
}
```

### `telemetry.reading.recorded`

```json
{
    "metric": "temperature",
    "value": 22.4,
    "unit": "celsius"
}
```

### `command.requested`

```json
{
    "commandType": "set.power",
    "requestedState": {
        "power": "on"
    },
    "requestedBy": "user"
}
```

### `command.dispatched`

```json
{
    "commandType": "set.power",
    "target": "simulator-adapter"
}
```

### `command.failed`

```json
{
    "reason": "command_already_active",
    "message": "Device already has an active command.",
    "commandType": "set.power",
    "requestedState": { "power": "on" },
    "requestedAt": "2026-05-21T07:10:00Z"
}
```

When a command fails before it becomes active, for example because the device
already has an active command, `command.failed` must include `commandType`,
`requestedState` and `requestedAt`. This lets the terminal projection retain
the rejected intent without misrepresenting it as an accepted `command.requested`.

### `command.timed_out`

```json
{
    "timeoutMs": 5000,
    "reason": "confirmation_not_received"
}
```

## Initial LED Command Boundary and Defaults

The initial LED command slice uses `POST /room/commands` for frontend-to-BFF
`set.power` requests. The HTTP response communicates backend acceptance or
rejection only; device confirmation remains a later outcome derived from a
matching `device.state.reported` event and delivered through the server-to-client
realtime stream. The realtime SSE stream accepts no application command messages.

For `led` `set.power`, the backend starts a 5000 ms timeout after dispatch. It
retains at most 20 terminal command projections in `recentCommands`, newest
first, evicting the oldest after the bound is exceeded. The `5000` value in the
`command.timed_out` example above is therefore the initial LED default, not a
global command timeout.

The full transport, retention and simulator-scenario decision is documented in
[ADR: LED Command Transport and Operational Defaults](../decisions/adr-led-command-transport-and-operational-defaults.md).

## Command Request Example

A command request captures the desired action. It is intent, not proof that the
device has changed.

```json
{
    "commandId": "cmd-123",
    "deviceId": "led-main",
    "commandType": "set.power",
    "requestedState": {
        "power": "on"
    },
    "requestedBy": "user",
    "requestedAt": "2026-05-21T07:10:00Z"
}
```

The event stream then records facts about this command request as the system
handles it. For example, `command.requested` means the platform accepted the
request, while `device.state.reported` is still needed to prove the device's
observable state.

## Validation Rules

- Malformed events should be rejected or stored in a quarantine stream.
- Event consumers may ignore additional envelope fields after validating the
  required current shape and event payload.
- Duplicate events should not create duplicate history entries.
- Command lifecycle events without a non-empty `commandId` should not update command state.
- Commands should be idempotent where possible, especially for retries.
- Events with valid envelopes but invalid payloads should be stored in the
  quarantine stream, not applied to derived state.

## In-Memory Deduplication Retention

The current in-memory processor rejects an accepted `eventId` for ten minutes.
It retains at most 1000 identifiers; when that limit is reached, it removes the
oldest identifier and records a metadata-only deduplication eviction diagnostic.
This bounds memory, but high event volume can shorten the effective retention
window. The guarantee ends when the process restarts; durable deduplication is
a future storage responsibility.

When a source can redeliver a native fact, its adapter must derive a globally
unique platform `eventId` from the fact's stable source identity and configured
source/device namespace. A replay is therefore deduplicable independently of
how many later messages the adapter received, without colliding with the same
native identity from another device or source.

## Naming Rules

- Event names should use past-tense facts, for example `command.dispatched`.
- Command names should use imperative intent, for example `set.power`.
- Event payloads should contain observed facts, not UI display labels.
- Contracts should remain stable enough for the simulator, backend and frontend to evolve independently.

Command correlation, confirmation matching and overlapping command behavior are
documented in [ADR: Command Correlation, Confirmation and Concurrency](../decisions/adr-command-correlation-confirmation-and-concurrency.md).
Terminal command projection and history rules are documented in
[ADR: Command History and Terminal Projections](../decisions/adr-command-history-and-terminal-projections.md).
Physical actuation and its effect on command outcomes are documented in
[ADR: External Actuation and Command Outcomes](../decisions/adr-external-actuation-and-command-outcomes.md).

`confirmed` is a terminal command projection, not an input platform event in
the initial slice. The event processor derives it only when a fresh
`device.state.reported` fact matches a pending command's confirmation rule.
