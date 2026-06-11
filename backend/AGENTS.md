# Backend Instructions

These instructions apply to files under `backend/`.

## Role

The backend owns the local platform boundary between device-like sources and
the realtime UI. It translates external observations into platform events,
validates event and command contracts, derives room state and eventually exposes
UI-oriented realtime APIs.

Follow the root `AGENTS.md`, the architecture docs and accepted ADRs. In
particular, keep backend behavior aligned with:

- `docs/architecture/control-loop.md`
- `docs/architecture/events-and-commands.md`
- `docs/architecture/devices.md`
- `docs/architecture/reliability-and-testing.md`
- `docs/decisions/adr-command-correlation-confirmation-and-concurrency.md`
- `docs/decisions/adr-device-command-confirmation-and-health-policy.md`
- `docs/decisions/adr-event-simulator-before-real-devices.md`
- `docs/decisions/adr-local-first-before-cloud.md`

For TypeScript modules in the backend, follow the root TypeScript rules.

## Boundaries

- Backend adapters translate simulator-native, hardware-native or external
  messages into platform events.
- Backend adapters translate platform commands into simulator-native or
  hardware-native commands.
- Simulator-native message shapes must not become platform contracts.
- UI-facing labels and display concerns must not become backend domain state.
- The frontend should receive derived projections or API responses, not be
  required to interpret raw device-native messages.
- Shared platform contracts live in `shared/src`; do not add backend-only or
  simulator-only fields to shared contracts.

## Events And Commands

- Use `docs/architecture/events-and-commands.md` for event envelope, payload,
  validation, quarantine and duplicate-handling rules.
- Use `docs/architecture/control-loop.md` and accepted command ADRs for command
  lifecycle, confirmation matching, timing and late-confirmation rules.
- Keep backend code aligned with those documents instead of redefining the
  contract in backend-local modules.

## Adapter Design

- Keep adapters small and testable. Prefer pure translation functions before
  adding transport, runtime or storage concerns.
- Name adapter modules after the external source and domain they translate, for
  example `adapters/simulator/temperature-adapter.ts`.
- Make source identity explicit, for example `simulator-adapter`.
- Inject clocks, ID generators and transport clients when they affect testable
  behavior.
- Keep adapter tests near the adapter module that owns the translation.

## State Derivation

- Use `docs/architecture/devices.md`, `docs/architecture/control-loop.md` and
  accepted device ADRs for state derivation, health, command availability and
  requested-vs-confirmed behavior.
- Keep derived projections explainable from accepted platform events and the
  documented device model.

## Realtime API

- Shape backend API responses for the realtime frontend without moving domain
  semantics into presentation code.
- Validate external input at backend boundaries before applying it to state.
- Keep raw event history useful for audit and debugging, even when current
  reads use derived projections.

## Testing

- Place tests near the backend module that owns the behavior.
- Prioritize contract tests for adapters, event validation, command lifecycle
  transitions and projection derivation.
- Use deterministic clocks, IDs and scenarios in tests.
- Add failure, duplicate, stale, timeout or late-confirmation tests when the
  touched behavior depends on those cases.

## Verification

Before finishing backend changes:

- Check available scripts in the relevant `package.json`.
- Run the narrowest relevant backend or repository check if one exists.
- If no backend command exists yet, say so explicitly.
- Check the change against the architecture docs and accepted ADRs listed
  above.
