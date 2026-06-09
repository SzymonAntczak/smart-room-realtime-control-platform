# Simulator Instructions

These instructions apply to files under `simulator/`.

## Role

The simulator represents device-like behavior before real hardware exists. It
should make realtime behavior, timing, uncertainty and failure modes repeatable
without pretending to be the backend or the frontend.

Follow the root `AGENTS.md`, the architecture docs and accepted ADRs. In
particular, keep the simulator aligned with:

- `docs/decisions/adr-event-simulator-before-real-devices.md`
- `docs/architecture/control-loop.md`
- `docs/architecture/events-and-commands.md`
- `docs/architecture/reliability-and-testing.md`

## Boundary

- The simulator may define simulator-native device messages and
  simulator-native commands.
- The simulator must not emit platform events directly unless the architecture
  explicitly changes.
- Translation between simulator-native messages and platform events belongs to
  the backend-owned simulator adapter, outside pure simulator device and
  scenario modules.
- Command lifecycle interpretation belongs outside the simulator. The simulator
  can accept or reject a native command, delay a response, stop reporting or
  report observed state, but it should not decide platform command statuses such
  as `pending`, `confirmed`, `failed` or `timed_out`.
- UI-facing projections belong outside the simulator.

## Device Modeling

- Prefer small domain folders by device or scenario, for example
  `temperature/` or `scenarios/telemetry-stops/`.
- Model device behavior as observable facts: readings, state reports, health
  changes, dropped messages, delayed responses and recovery.
- Keep generated data realistic enough to exercise the control loop, but
  deterministic enough for tests unless a test explicitly controls randomness.
- Inject clocks, timers, random number generators or schedules instead of
  hiding time and randomness inside modules that need tests.
- Include timestamps in simulator-native messages when the simulated device
  would reasonably know when the observation happened.

## Failure Scenarios

Simulator scenarios should be named after system behavior, not implementation
mechanics.

Prioritize scenarios documented in reliability architecture:

- delayed confirmations
- command rejection
- lost telemetry event
- duplicate telemetry event
- device goes stale
- device goes offline
- degraded device reporting partial data
- late confirmation after command timeout

## Contracts

- Shared platform contracts live in `shared/src`.
- Do not add simulator-only fields to shared platform contracts.
- Add simulator-native types close to the simulator domain that owns them.
- Promote a simulator behavior into architecture docs or an ADR before treating
  it as a durable platform rule.

## Testing

- Place simulator tests near the simulator module that owns the behavior.
- Prefer deterministic scenario tests over tests that depend on wall-clock time.
- Test emitted native messages, accepted native commands and scenario timing.
- Adapter translation tests belong with the backend adapter boundary, outside
  pure simulator tests.

## Verification

Before finishing simulator changes:

- Check available scripts in the relevant `package.json`.
- Run the narrowest useful simulator or repository check if one exists.
- If no simulator command exists yet, say so explicitly.
- Check the change against the architecture docs and accepted ADRs listed above.
