# Smart Room Realtime Control Platform

## Project Purpose

This repository is a local-first realtime/IoT systems design project. The goal
is to build a small but credible smart-room control platform that makes device
state, user intent, time, uncertainty and failure visible.

AI is an implementation assistant here, not the owner of the architecture. Keep
system behavior, event contracts, state modeling, control UX and reliability
rules aligned with the project documentation.

## Important Context

- Start with `README.md` and `docs/README.md` for orientation.
- Product and learning direction live in `docs/planning/goal.md` and
  `docs/planning/roadmap.md`.
- Core system behavior lives in `docs/architecture/`.
- Stable decisions live in `docs/decisions/`; early trade-offs live in
  `docs/decisions/tradeoffs.md`.
- There is no committed application manifest yet. Do not invent build, lint or
  test commands before checking the repo.

## System Rules To Preserve

- Events are facts that already happened; commands are requests for something to
  happen.
- Commands are intent, not proof of device state.
- The UI must distinguish requested, pending, confirmed, failed, timed-out,
  stale and offline states.
- Device reports are observable facts and can update current state even when
  they arrive late.
- A timed-out command must not later become confirmed because of a late device
  report.
- The first implementation should allow only one pending command per device.
- Failure, stale data and missing data should be visible user states, not hidden
  implementation details.

## Working Style

- Read the relevant docs before changing behavior.
- Keep changes small and explainable.
- Prefer explicit contracts and named states over implicit UI assumptions.
- Update architecture or decision docs when behavior rules change.
- When adding tests, prioritize state derivation, command lifecycle, simulator
  scenarios and user-visible reliability over superficial coverage.
- Avoid broad refactors unless they directly support the requested change.

## Verification

Before considering work done, check the change against:

- `docs/architecture/events-and-commands.md`
- `docs/architecture/control-loop.md`
- `docs/architecture/reliability-and-testing.md`
- relevant ADRs in `docs/decisions/`

If executable commands exist for the touched area, run the narrowest useful
tests or checks and report what was run. If no commands exist yet, say so
explicitly.
