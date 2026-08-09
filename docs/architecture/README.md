# Architecture

This folder describes the current target shape of the Smart Room Realtime
Control Platform.

Architecture documents are the working model for system behavior: control
flows, device state, event contracts, reliability rules and examples. Durable
decisions and trade-offs live in [decisions](../decisions/).

## Start Here

Read these documents in this order when you need to understand or change system
behavior:

1. [System overview](system-overview.md)
2. [Control loop](control-loop.md)
3. [Devices](devices.md)
4. [Events and commands](events-and-commands.md)
5. [Reliability and testing](reliability-and-testing.md)
6. [Architecture examples](examples.md)
7. [System context](system-context.md)
8. [AI collaboration model](ai-collaboration.md)

## Document Map

| Document                                              | Use it for                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [System overview](system-overview.md)                 | Domain boundaries, MVP scope, main components and the local-first assumption.                                     |
| [Control loop](control-loop.md)                       | Read path, command path, requested vs confirmed state and timing rules.                                           |
| [Devices](devices.md)                                 | Availability, health, observation freshness, command states, state fields and command availability.               |
| [Events and commands](events-and-commands.md)         | Event envelope, event types, command lifecycle events and validation rules.                                       |
| [Reliability and testing](reliability-and-testing.md) | Failure modes, observability, recovery behavior and test strategy.                                                |
| [Architecture examples](examples.md)                  | Concrete flows for command confirmation, timeout, availability/health/freshness recovery and projection behavior. |
| [System context](system-context.md)                   | High-level component context diagram.                                                                             |
| [AI collaboration model](ai-collaboration.md)         | Source-of-truth hierarchy for docs, AGENTS.md files, skills and subagent reviews.                                 |

## Rules To Preserve

The completed Stage 2/2.5 implementation is a read-only simulated temperature
reference slice. It uses the backend adapter, event processor, read-model
projection and realtime BFF. It exposes independent availability, operational
health and observation freshness; event history is a later dedicated slice. Development-only controls
exercise normal and failure scenarios through that same backend-owned path.
The broader command rules below remain the target model for the later LED
control slice.

- Events are facts that already happened.
- Commands are requests for something to happen.
- Requested state is not confirmed device state.
- The UI must show command progress, availability, degraded health and
  applicable stale observation data explicitly.
- A late device report can update reported state, but it must not turn a
  timed-out command into a confirmed command.
- The first implementation allows only one active command (`accepted` or
  `pending`) per device.
- Failure, stale data and missing data are user-visible states.

## Related Decisions

- [ADR: Local-first before cloud](../decisions/adr-local-first-before-cloud.md)
- [ADR: Event simulator before real devices](../decisions/adr-event-simulator-before-real-devices.md)
- [ADR: Command correlation, confirmation and concurrency](../decisions/adr-command-correlation-confirmation-and-concurrency.md)
- [ADR: Device availability, health and observation freshness](../decisions/adr-device-availability-and-observation-freshness.md)
- [ADR: Device command confirmation and health policy](../decisions/adr-device-command-confirmation-and-health-policy.md)
- [ADR: MQTT source parity before device expansion](../decisions/adr-mqtt-source-parity-before-device-expansion.md)
- [Trade-offs and decision log](../decisions/tradeoffs.md)

## Updating Architecture

When implementation changes system behavior, update the relevant architecture
document in this folder. When the change represents a durable decision, add or
update an ADR in [decisions](../decisions/) and link it from the affected
architecture document.
