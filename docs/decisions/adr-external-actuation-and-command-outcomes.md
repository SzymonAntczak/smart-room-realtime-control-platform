# ADR: External Actuation and Command Outcomes

## Status

Accepted

## Context

A controllable LED may be changed by a physical button while a frontend command
is accepted or pending. The platform must keep reported device state truthful
without claiming causal knowledge that the device protocol does not provide.

The current command model confirms `set.power` from a fresh matching reported
state. Device reports do not carry a `commandId` by default, and the first
hardware slice must not add a correlation protocol or terminal status solely to
distinguish a simultaneous physical action from a frontend request.

## Options Considered

- Treat matching observed state as the outcome of an active command without
  claiming that the command caused it.
- Require device-native correlation for confirmation and add a terminal
  `superseded` or `interrupted` status for physical actuation.
- Translate every physical button press into a platform `set.power` command.

## Decision

The initial physical-input model is outcome-based, not cause-attributed.

Every accepted, time-valid physical LED state report updates the observed
device state, whether or not a frontend command is active. Physical actuation
is not blocked, queued or rewritten as a platform command.

While a `set.power` command is pending, a fresh report whose power state exactly
matches the requested state confirms that command. `confirmed` means the
requested observable state was reached; it does not prove whether frontend
intent or physical actuation caused the change. A non-matching physical report
still updates reported state but leaves the command pending until a matching
report, explicit failure or timeout. The physical input cannot reconfirm a
timed-out command.

The shared command lifecycle adds no `superseded` or `interrupted` status in
this slice. Device-native protocol details may preserve physical-input origin
for adapter diagnostics, but no cross-boundary origin field is required yet.

## Consequences

- The physical button and Dashboard remain usable concurrently without hiding
  actual device state.
- A user can see that the LED's confirmed state differs from the still-pending
  requested state; the command will then finish through the existing failure or
  timeout rules unless a matching report arrives.
- Command history describes an observed outcome, not proven causal attribution.
- The model avoids adding protocol correlation, new terminal states and UI
  explanation rules before hardware evidence shows that they are needed.
- A future causal-audit requirement must introduce an explicit device-native
  origin or correlation contract and revisit command terminal states.

## Verification

- A physical state report with no active command updates the LED projection.
- During a pending `set.power`, a matching physical report updates the
  projection and produces `confirmed`.
- During a pending `set.power`, a non-matching physical report updates the
  projection while the command remains pending.
- A matching physical report after timeout updates state but leaves the command
  terminally `timed_out`.
- UI tests keep requested, observed and command-outcome information distinct
  when physical actuation and Dashboard intent overlap.

## Links

- Related architecture document: [Control Loop](../architecture/control-loop.md)
- Related architecture document: [Devices](../architecture/devices.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related decision: [Command Correlation, Confirmation and Concurrency](adr-command-correlation-confirmation-and-concurrency.md)
- Related decision: [Device Command Confirmation and Health Policy](adr-device-command-confirmation-and-health-policy.md)
