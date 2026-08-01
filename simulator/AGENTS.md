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

For TypeScript modules in the simulator, follow the root TypeScript rules.

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

## Contracts

- Shared platform contracts live in `shared/src`.
- Do not add simulator-only fields to shared platform contracts.
- Add simulator-native types close to the simulator domain that owns them.
- Use the linked architecture documents for platform rules; do not restate
  lifecycle or UI behavior here.

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
