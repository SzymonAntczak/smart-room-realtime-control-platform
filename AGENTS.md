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
- AI-facing context hierarchy lives in
  `docs/architecture/ai-collaboration.md`.
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
- Consider time and memory complexity when choosing collections, loops and data
  transformations. Use `Map` or `Set` for repeated or hot key lookups and
  membership checks; keep a one-off scan of a small array when it is clearer
  and not performance-sensitive.
- Do not add indexes or caches without a demonstrated need: account for their
  memory, maintenance cost and added complexity. Prefer named lookup data over
  long `if`/`else` chains when modeling a known set of variants.

## Repository Structure

- Prefer domain-driven folder architecture over type-driven folders.
- Group code by product/system domain and behavior, not by technical layer alone.
- Avoid broad folders like `components`, `services`, `utils` or `types` when a
  domain folder would make ownership clearer.
- Shared code should become shared only after there is real reuse.
- Keep event, command, simulator and state-derivation code close to the domain it
  describes.

## Module Boundaries And Imports

- Treat top-level packages and domain folders as architectural boundaries, not
  just file organization.
- `shared` may expose stable contracts, event shapes, command shapes and domain
  primitives used by multiple runtimes. It must not import from `frontend`,
  `backend` or `simulator`.
- `frontend` may import shared contracts and its own domain/UI modules. It must
  not import backend, simulator or server runtime internals.
- `backend` may import shared contracts and backend-local platform, runtime,
  adapter and API modules. Backend platform/domain code should not depend on API
  handlers, simulator adapters or other outer runtime details unless an
  architecture document says so.
- Backend runtime/composition modules may wire concrete adapters and source
  runtimes, such as the simulator, when building a runnable local slice. Keep
  source-specific behavior behind adapters and do not let it leak into
  `src/platform/` or shared contracts.
- `simulator` may import shared contracts and simulator-local device behavior.
  It must not import frontend or backend internals.
- Cross-domain imports inside a package should go through an explicit shared
  contract, port or small public module for that domain. Avoid reaching into
  another domain folder's private implementation files.
- If a change needs to reverse an import direction, introduce a new shared
  contract/port or update the relevant architecture or decision document before
  treating the new dependency as normal.

## Verification

Before considering behavior work done, check the change against the relevant
architecture docs and accepted ADRs.

If executable commands exist for the touched area, run the narrowest useful
tests or checks and report what was run. If no commands exist yet, say so
explicitly.

## Test Quality

- Treat tests as protection for system behavior, not as coverage decoration.
- Prefer tests that exercise documented behavior, domain invariants, failure
  modes and user-visible reliability risks.
- Cover important negative and boundary cases when they affect the touched
  behavior, such as malformed events, duplicate events, unsupported versions,
  lifecycle cleanup, ordering, limits, stale/offline state, timeouts and late
  confirmations.
- Avoid tests that pass trivially because assertions are too broad, only mirror
  implementation details, or do not fail when the behavior is broken.
- Avoid redundant tests that repeat the same scenario without covering a
  distinct risk.
