# Events and Commands

## Contract Principles

Events are facts that already happened. Commands are requests for something to happen.

This distinction keeps the system auditable and prevents the UI from treating user intent as device truth.

Commands are not events. A command represents intent, for example `set.power`.
The system records facts about that command as events, for example `command.requested`,
`command.dispatched` and `command.confirmed`.

In other words, the command says "please do this". Command-related events say
"this part of the command lifecycle happened".

## Common Event Envelope

Every stored event should include a stable envelope.

```json
{
  "eventId": "evt-123",
  "eventType": "device.state.reported",
  "version": 1,
  "occurredAt": "2026-05-21T07:10:01Z",
  "source": "simulator",
  "deviceId": "led-main",
  "payload": {}
}
```

Required envelope fields:

- `eventId`: unique event identifier for deduplication
- `eventType`: stable event name
- `version`: contract version
- `occurredAt`: time when the fact happened
- `source`: producer name, for example `simulator`, `hardware-adapter` or `backend`
- `payload`: event-specific data

Optional envelope fields:

- `deviceId`: related device when applicable
- `commandId`: related command for command lifecycle events

Command lifecycle events must include the `commandId` they describe. Device
state reports do not include `commandId` by default; they are observed device
facts and may confirm a pending command only through the processor's matching
rules.

## Initial Event Types

| Event type | Purpose |
| --- | --- |
| `device.state.reported` | Device reported its current observable state. |
| `device.health.changed` | Device health changed between `online`, `offline`, `stale` or `degraded`. |
| `telemetry.reading.recorded` | Sensor reading was recorded. |
| `command.requested` | User or automation request was accepted as a command. |
| `command.dispatched` | Backend sent a command to a device or simulator. |
| `command.confirmed` | Command completion was confirmed. |
| `command.failed` | Command failure was detected explicitly. |
| `command.timed_out` | Command did not complete within the allowed time. |

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

### `device.health.changed`

```json
{
  "previousHealth": "stale",
  "health": "offline",
  "reason": "offline_threshold_exceeded"
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
  "target": "simulator"
}
```

### `command.confirmed`

```json
{
  "confirmationSource": "device.state.reported",
  "matchedState": {
    "power": "on"
  }
}
```

### `command.failed`

```json
{
  "reason": "command_already_pending",
  "message": "Device already has an active pending command."
}
```

### `command.timed_out`

```json
{
  "timeoutMs": 5000,
  "reason": "confirmation_not_received"
}
```

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

- Unknown event versions should not update derived state silently.
- Malformed events should be rejected or stored in a quarantine stream.
- Duplicate events should not create duplicate history entries.
- Command lifecycle events without a valid `commandId` should not update command state.
- Commands should be idempotent where possible, especially for retries.
- Events with valid envelopes but invalid payloads should be stored in the
  quarantine stream, not applied to derived state.

## Naming Rules

- Event names should use past-tense facts, for example `command.dispatched`.
- Command names should use imperative intent, for example `set.power`.
- Event payloads should contain observed facts, not UI display labels.
- Contracts should remain stable enough for the simulator, backend and frontend to evolve independently.

Command correlation, confirmation matching and overlapping command behavior are
documented in [ADR: Command Correlation, Confirmation and Concurrency](../decisions/adr-command-correlation-confirmation-and-concurrency.md).
