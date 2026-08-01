# Backend Instructions

These instructions apply to files under `backend/`.

## Role

The backend owns the local platform boundary between device-like sources and
the realtime UI. It translates external observations into platform events,
validates event and command contracts, derives backend read-model projections
and eventually exposes UI-oriented realtime APIs.

Follow the root `AGENTS.md`, the architecture docs and accepted ADRs. In
particular, keep backend behavior aligned with:

- `docs/architecture/control-loop.md`
- `docs/architecture/events-and-commands.md`
- `docs/architecture/devices.md`
- `docs/architecture/reliability-and-testing.md`
- `docs/decisions/adr-command-correlation-confirmation-and-concurrency.md`
- `docs/decisions/adr-device-command-confirmation-and-health-policy.md`
- `docs/decisions/adr-command-history-and-terminal-projections.md`
- `docs/decisions/adr-json-schema-transport-contracts.md`
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
- Stable backend platform behavior lives under `src/platform/`; source-specific
  integrations live under `src/adapters/`.

## Composition Model

Backend development should preserve a compositional runtime model:

```text
adapter -> event processor -> read model / projections -> realtime API / BFF
realtime API / BFF -> command handling -> adapter -> device or simulator
```

Treat runtimes as wiring, not as owners of domain behavior. A future runtime may
choose simulator, Home Assistant, MQTT or hardware adapters and connect them to
the same platform event processor, read model and API boundary. New adapters,
command handlers, storage backends or transport clients should be replaceable
modules that speak the documented platform event and command contracts.

Do not let source-specific concerns leak across this composition boundary. For
example, Home Assistant entities, simulator-native messages or MQTT topics
should be translated at adapter boundaries before the event processor or read
model sees them.

Command paths are part of the same composition model. The realtime API/BFF may
accept user intent, but command lifecycle interpretation and dispatch rules must
stay in backend platform code and adapters must translate platform commands into
source-specific commands.

## Adapter Design

- Keep adapters small and testable. Prefer pure translation functions before
  adding transport, runtime or storage concerns.
- Name adapter modules after the external source and domain they translate, for
  example `adapters/simulator/temperature/temperature-adapter.ts`.
- Make source identity explicit, for example `simulator-adapter`.
- Inject clocks, ID generators and transport clients when they affect testable
  behavior.
- Keep adapter tests near the adapter module that owns the translation.

## Realtime API

- Shape backend API responses for the realtime frontend without moving domain
  semantics into presentation code.
- Validate external input at backend boundaries before applying it to state.
- Follow the binding docs above for projection semantics and history.

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
