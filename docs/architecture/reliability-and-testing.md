# Reliability and Testing

## Core Reliability Rules

- The UI must distinguish requested state from confirmed state.
- Offline devices must not be silently treated as healthy.
- Stale data must be visible when it is still shown.
- A future dedicated history slice should make important user actions traceable.
- Command failures and timeouts should be first-class states, not generic errors.
- Terminal command outcomes should remain available through bounded command
  history with their reason and timing metadata.

## Failure Modes To Simulate

The completed temperature reference slice covers the following read-path
scenarios through automated tests and development controls where applicable:

- lost telemetry event
- duplicate telemetry event
- device goes stale
- device goes offline
- device recovers with a fresh reading
- invalid telemetry payload
- realtime stream reconnect while retaining the last valid snapshot

Future command slices should add delayed confirmations, command rejection,
degraded reports and late confirmation after timeout. Future-dated device
reports are already rejected by the platform event contract and are covered by
backend tests; they do not yet have a manual scenario control.

## Observability

The platform should make these questions easy to answer:

- What did the user request?
- When was the command dispatched?
- What did the device actually report?
- Did the command fail, time out or complete?
- Did any matching device report arrive after the command timed out?
- Was the device healthy when the command was sent?

## Recovery Behavior

When a device reconnects after being stale or offline:

1. the device should report a fresh state
2. the processor should mark the device as `online`
3. the UI should replace stale values with confirmed fresh values
4. unresolved commands should remain historically visible, even if the current state is now healthy

## Testing Strategy

The testing strategy should follow the risk in the system: state derivation, command lifecycle and realtime UI behavior matter more than superficial coverage.

### Contract Tests

Contract tests should verify that events and commands match the documented schemas.

Focus areas:

- required envelope fields
- unknown or malformed events
- idempotency for duplicate events

### State Model Tests

State model tests should cover how raw events become derived room state.

Focus areas:

- reported state updates
- requested state tracking
- command confirmation
- command failure and timeout
- late confirmation after timeout
- stale and offline transitions

### Simulator Scenario Tests

Simulator scenarios should be repeatable and named after real failure modes.

Initial scenarios:

- `confirm_immediately`: matching LED state report immediately after the native command
- `confirm_delayed`: matching LED state report 2000 ms after the native command
- `reject_command`: explicit LED command rejection without a state report
- `omit_confirmation`: no LED state report, so the command times out after 5000 ms
- `report_after_timeout`: matching LED state report after 6000 ms; it updates
  observed state but does not reconfirm the timed-out command
- telemetry stops and device becomes stale
- stale device becomes offline
- device reconnects and reports fresh state
- future-dated report is ignored and a later time-valid report recovers health

### UI Behavior Tests

UI tests should verify user-visible system behavior.

Focus areas:

- accepted and pending command progress is visible
- confirmed state is not faked from requested state
- stale and offline states are visible
- failed and timed-out commands remain understandable
- future history work has an explicit traceability acceptance criterion

The LED scenario timing and transport defaults are defined in
[ADR: LED Command Transport and Operational Defaults](../decisions/adr-led-command-transport-and-operational-defaults.md).

## Manual Acceptance Checklist

Before treating a milestone as done, verify:

- a user can see current room state
- a user can send a command
- the UI shows the command as pending before confirmation
- the UI updates after a device report
- command outcome and failure state remain visible
- at least one failure scenario is visible, not hidden
