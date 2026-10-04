# Trade-Offs and Decision Log

This file captures early architectural and delivery trade-offs that are useful
to remember but do not yet need a dedicated ADR.

When a decision becomes stable, controversial or expensive to change, promote it
into a dedicated ADR in this directory.

## Minimal Hardware First

Decision: hardware is intentionally minimal at the beginning.

Reason: the main goal is realtime system design, not electronics.

Benefit: faster iteration and stronger focus on architecture, event flow and UI behavior.

Cost: less physical realism early in the project.

Consequence: the simulator must be good enough to exercise realistic latency, offline and failure scenarios.

Status: partially promoted to [ADR: Event Simulator Before Real Devices](adr-event-simulator-before-real-devices.md).

## Simulator Before Real Devices

Decision: the first useful slice should use simulated devices before physical
hardware becomes part of the main loop.

Reason: the hardest system behaviors are command lifecycle, delayed
confirmation, stale data, offline states and UI trust. These are easier to
repeat with a simulator than with early hardware.

Benefit: failure scenarios become deterministic enough to test and demonstrate.

Cost: the simulator can become too idealized if it is not checked against real
device behavior later.

Consequence: simulator scenarios should be treated as part of the system, not
as disposable demo data.

Status: promoted to [ADR: Event Simulator Before Real Devices](adr-event-simulator-before-real-devices.md).

## Local-First Before Cloud

Decision: the initial platform scope should run locally without cloud infrastructure.

Reason: remote access, authentication, synchronization and deployment topology
would add noise before the core control loop is understood.

Benefit: the system is easier to run, debug and explain during early stages.

Cost: cloud-specific concerns are deferred and will need their own design later.

Consequence: future cloud integration must preserve the same event, command and
state contracts instead of replacing the core model.

Status: promoted to [ADR: Local-First Before Cloud](adr-local-first-before-cloud.md).

## Honest Control UX Over Optimistic UI

Decision: the UI should not treat requested state as confirmed state.

Reason: a control interface becomes misleading if it shows intent as reality
before there is device evidence.

Benefit: users can understand pending, failed, timed-out and uncertain states.

Cost: the UI is more complex than a simple dashboard because it must show
multiple layers of state at once.

Consequence: command lifecycle, confirmation matching and late confirmation
rules must be explicit.

Status: promoted to [ADR: Command Correlation, Confirmation and Concurrency](adr-command-correlation-confirmation-and-concurrency.md).

## Derived Projections Without Full Event Sourcing

Decision: store enough event history for audit and debugging, but do not require
full event sourcing in the first implementation.

Reason: the project needs traceability, but full event sourcing would add
complexity before the basic control loop exists.

Benefit: the system can explain important actions while still keeping the first
implementation approachable.

Cost: rebuilding all current state from the complete event stream may not be a
first-class requirement at the beginning.

Consequence: raw events should remain useful for audit, while projections or
snapshots can be used for current reads.

Status: keep as trade-off for now.

## Read-Path Scope Reset (Superseded)

Decision: withdraw an oversized runtime decision and establish a smaller
read-only temperature path before the full control loop.

Reason: coupled backend, transport, commands and simulator work obscured the
simplest observable realtime outcome.

Benefit: one understandable sensor path reduced scaffold and runtime assumptions.

Cost at the time: backend, bidirectional transport, commands and a separate
simulator runtime were deferred while the read path was simplified.

Consequence: the temporary frontend-only approach was an incremental starting
point, not a durable platform boundary. Backend-owned adapters, processing,
projections and the SSE BFF define the agreed runtime responsibilities.

Status: historical trade-off; superseded by the backend-owned architecture and
accepted transport and command decisions.

## AI As Implementation Assistant

Decision: AI can help with implementation, documentation drafts, tests and
refactoring, but it does not own architecture or system behavior.

Reason: the project should demonstrate deliberate system design, not only fast
code generation.

Benefit: AI can accelerate work while the human owner remains responsible for
event contracts, state modeling, reliability rules and final acceptance.

Cost: AI output must be reviewed carefully because it may hide incorrect
assumptions behind plausible code or wording.

Consequence: AI-assisted changes should be checked against the event contract,
device state model, command lifecycle and user-visible reliability rules.

Status: keep as project working rule.
