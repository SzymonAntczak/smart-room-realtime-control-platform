# Reliability and Testing

## Core Reliability Rules

- The UI must distinguish requested state from confirmed state.
- Offline devices must not be silently treated as healthy.
- Stale data must be visible when it is still shown.
- Every important user action should be visible in event history.
- Command failures and timeouts should be first-class states, not generic errors.

## Failure Modes To Simulate

The simulator should eventually cover:

- delayed confirmations
- command rejection
- lost telemetry event
- duplicate telemetry event
- future-dated device report
- device goes stale
- device goes offline
- degraded device reporting partial data
- late confirmation after command timeout

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
- supported event versions
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

- normal command confirmation
- delayed command confirmation
- command rejected by device
- late confirmation after timeout
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
- event history contains important user actions

## Manual Acceptance Checklist

Before treating a milestone as done, verify:

- a user can see current room state
- a user can send a command
- the UI shows the command as pending before confirmation
- the UI updates after a device report
- the event history explains what happened
- at least one failure scenario is visible, not hidden
