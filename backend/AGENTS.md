# Backend Instructions

Applies to `backend/`. The backend translates device-like sources into validated
platform events, command handling, read-model projections and realtime APIs.
Follow root `AGENTS.md` and the coding/testing guide it routes to.

## Relevant Sources

Read sources relevant to the touched behavior, including control-loop,
events-and-commands, devices and reliability-and-testing in `docs/architecture/`.
Consult accepted ADRs for command correlation/concurrency, device confirmation and
health, command history, JSON Schema transport, simulator-before-hardware,
local-first architecture and MQTT source parity when touching those boundaries.

## Composition And Adapters

- Preserve `adapter -> event processor -> projections -> API/BFF` and
  `API/BFF -> command handling -> adapter -> source`. Runtimes wire replaceable
  adapters, storage and transport; platform code owns lifecycle and dispatch.
- `src/platform/` owns stable platform behavior; `src/adapters/` owns source
  translation. Native messages, Home Assistant entities and MQTT topics stay
  behind adapters. Adapters translate observations and commands in both directions.
- API responses expose derived projections, not native messages for UI interpretation.
  UI labels/display concerns do not become backend domain state.
- Keep adapters small and testable; prefer pure translation before adding runtime,
  transport or storage. Name modules by source and domain (for example
  `adapters/simulator/temperature/temperature-adapter.ts`) and make source identity
  explicit (for example `simulator-adapter`).
- Inject clocks, ID generators and transport clients when they affect behavior.
  Validate external input before applying it to state. Shape responses for the
  frontend without moving domain semantics into presentation code.

## Verification

Use Module Boundaries And Imports, Test Quality and Verification in
`docs/development/coding-guidelines.md`, with `backend/package.json` for commands.
Prioritize adapter contracts, event validation, command transitions and
projection derivation.
