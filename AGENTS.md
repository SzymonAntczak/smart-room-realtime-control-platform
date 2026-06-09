# Smart Room Realtime Control Platform

## Project Purpose

This repository is a local-first realtime/IoT systems design project. The goal
is to build a small but credible smart-room control platform that makes device
state, user intent, time, uncertainty and failure visible.

AI is an implementation assistant here, not the owner of the architecture.

## Important Context

- Start with `README.md` and `docs/README.md` for orientation.
- Product and learning direction live in `docs/planning/goal.md` and
  `docs/planning/roadmap.md`.
- Core system behavior lives in `docs/architecture/`.
- Stable decisions live in `docs/decisions/`; early trade-offs live in
  `docs/decisions/tradeoffs.md`.
- The documentation is the source of truth for project behavior. Treat
  `docs/architecture/` and accepted ADRs in `docs/decisions/` as binding unless
  the user explicitly asks to change them.
- Planning docs describe direction and learning goals; promote a planning idea
  to architecture or an ADR before treating it as a durable system rule.
- Do not invent build, lint or test commands before checking the repo.

## Behavior Changes

- Before changing system behavior, read the relevant architecture docs and ADRs.
- If implementation, tests or examples disagree with the docs, treat that as
  drift and make the resolution explicit.
- Update architecture or decision docs when the intended behavior changes.

## Working Style

- Keep changes small and explainable.
- Avoid broad refactors unless they directly support the requested change.

## TypeScript

- Prefer `unknown` over `any`.
- Prefer discriminated unions for observable lifecycle and domain states.
- Use `as const`, `satisfies`, utility types and narrow type guards where they
  clarify intent.
- Avoid stringly typed state when a named type would better express the domain.

## Repository Structure

- Prefer domain-driven folder architecture over type-driven folders.
- Group code by product/system domain and behavior, not by technical layer alone.
- Avoid broad folders like `components`, `services`, `utils` or `types` when a
  domain folder would make ownership clearer.
- Shared code should become shared only after there is real reuse.
- Keep event, command, simulator and state-derivation code close to the domain it
  describes.

## Verification

Before considering behavior work done, check the change against the relevant
architecture docs and accepted ADRs.

If executable commands exist for the touched area, run the narrowest useful
tests or checks and report what was run. If no commands exist yet, say so
explicitly.
