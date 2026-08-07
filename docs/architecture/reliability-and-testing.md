# Reliability and Testing

## Core Reliability Rules

- The UI must distinguish requested state from confirmed state.
- Device availability must not be inferred from the age of telemetry or state reports.
- Offline devices must not be silently treated as available.
- Degraded health must be visible without being misrepresented as offline.
- Stale observation data must be visible when it is still shown.
- A future dedicated history slice should make important user actions traceable.
- Command failures and timeouts should be first-class states, not generic errors.
- Terminal command outcomes should remain available through bounded command
  history with their reason and timing metadata.

## Failure Modes To Simulate

The completed temperature reference slice covers the following read-path
scenarios through automated tests and development controls where applicable:

- lost telemetry event
- duplicate telemetry event
- telemetry observation becomes stale while availability remains unchanged
- device becomes explicitly offline
- device recovers availability and later reports a fresh observation
- invalid telemetry payload
- realtime stream reconnect while retaining the last valid snapshot

Future command slices should add delayed confirmations, command rejection and
late confirmation after timeout. Degraded health reports must be part of the
device-state model. Future-dated device
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

When explicit availability evidence reports that a device reconnects:

1. the processor should mark the device as `online`
2. a later accepted observation should update `lastObservedAt` and freshness
3. the UI should replace stale values when a fresh observation arrives
4. unresolved commands should remain historically visible, even after recovery

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
- independent availability and freshness transitions
- health degradation and recovery transitions

### Simulator Scenario Tests

Simulator scenarios should be repeatable and named after real failure modes.

Initial scenarios:

- `confirm_immediately`: matching LED state report immediately after the native command
- `confirm_delayed`: matching LED state report 2000 ms after the native command
- `reject_command`: explicit LED command rejection without a state report
- `omit_confirmation`: no LED state report, so the command times out after 5000 ms
- `report_after_timeout`: matching LED state report after 6000 ms; it updates
  observed state but does not reconfirm the timed-out command
- telemetry stops and its observation becomes stale while availability stays online
- explicit device disconnection changes availability to offline
- explicit reconnection changes availability to online; a later report refreshes observation data
- device health becomes degraded while availability remains online
- degraded health recovers without rewriting availability or freshness
- future-dated report is ignored and a later time-valid report refreshes the observation

### UI Behavior Tests

UI tests should verify user-visible system behavior.

Focus areas:

- accepted and pending command progress is visible
- confirmed state is not faked from requested state
- availability and stale observation data are visible as distinct states
- degraded health is visible separately from availability and freshness
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
