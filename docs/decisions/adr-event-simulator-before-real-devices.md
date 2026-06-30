# ADR: Event Simulator Before Real Devices

## Status

Accepted

## Context

The platform needs to exercise realtime behavior, command latency, offline
states, stale data and failure recovery. Relying only on physical devices early
would make these scenarios slower to create and harder to repeat.

The simulator must exercise the same event and command contracts as real
hardware adapters, otherwise it can teach the system assumptions that will not
hold later. The simulator itself can use simulator-native messages; the
backend-owned simulator adapter translates those messages to and from platform
events and commands.

## Options Considered

- Build against real devices first.
- Build a simulator before integrating real devices.
- Build simulator and real hardware support in parallel.

## Decision

Build the event simulator early, before depending on real devices for core
development and testing.

The simulator should emit realistic simulator-native device messages, accept
simulator-native commands and model common edge cases such as latency, explicit
failures, stale data, offline periods and recovery.

This is a per-slice delivery rule, not a requirement to finish the whole
simulated room before any hardware appears. Each new device role or capability
should be proven in the simulator first, then validated on the corresponding
real hardware before the roadmap moves on to the next device role.

## Consequences

The system can test edge cases without requiring a large physical device setup.
This makes development faster and makes failure scenarios easier to repeat.

The simulator must be maintained as part of the architecture, not treated as a
throwaway demo. Simulator scenarios should act like test fixtures for the
control loop and event contracts.

The simulator should remain device-like. Platform event validation, command
lifecycle interpretation and UI-facing state derivation belong to the backend,
not the simulator.

There is a risk that the simulator becomes too idealized. Real device
integration is still needed to validate timing, transport behavior and hardware
quirks.

Real hardware should therefore appear early after each reliable simulated slice.
Hardware validation should check whether the simulator-taught event contracts,
state derivation, command lifecycle and UI expectations still hold under real
device timing and connectivity.

## Links

- Related architecture document: [Control Loop](../architecture/control-loop.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related architecture document: [Reliability and Testing](../architecture/reliability-and-testing.md)
