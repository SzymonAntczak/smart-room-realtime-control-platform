# Simulator Instructions

Applies to `simulator/`. Model repeatable device behavior, timing, uncertainty and
failure before real hardware; the simulator does not own backend or UI semantics.
Follow root `AGENTS.md` and the coding/testing guide it routes to.

Read the relevant control-loop, events-and-commands and reliability-and-testing
architecture, and the simulator-before-hardware and MQTT source-parity ADRs
before changing behavior.

## Modeling And Contracts

- Use small device/scenario domain folders, such as `temperature/` or
  `scenarios/telemetry-stops/`. Model observable readings, state/health reports,
  dropped messages, delayed responses and recovery.
- Keep modeled data realistic. Inject clocks, timers, random generators or
  schedules into testable modules.
- Include native observation timestamps when the modeled device would know them.
- Native types live beside their owning simulator domain.

## Verification

Use Module Boundaries And Imports, Test Quality and Verification in
`docs/development/coding-guidelines.md`, with `simulator/package.json` for commands.
Scenario tests protect emitted native messages, accepted native commands and
timing. Backend adapter tests own translation, outside pure simulator tests.
