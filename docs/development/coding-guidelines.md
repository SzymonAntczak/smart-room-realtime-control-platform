# Coding And Testing Guidelines

Read the relevant sections when changing or reviewing code, module boundaries or
tests. This guide owns shared development conventions; AGENTS.md files route
agents here. Architecture and accepted ADRs remain binding for product behavior.

## TypeScript

- Prefer `unknown` over `any`.
- Do not use postfix TypeScript non-null assertions (`value!`). Model absence in
  types and narrow values with type guards instead. This does not prohibit
  logical negation (`!value`) or inequality (`!==`).
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
  `backend` or `simulator`. Do not add backend-only or simulator-only fields to
  shared contracts.
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

Check the applicable package manifests before selecting commands. If executable
commands exist for the touched area, run the narrowest useful tests or checks and
report what was run. If no relevant commands exist yet, say so explicitly.

## Test Suite Boundaries

- Frontend browser integration uses the mocked BFF. For that suite and its
  harness/configuration, read the Browser Integration Tests section of
  [frontend guidelines](frontend-guidelines.md) and
  [the Playwright ADR](../decisions/adr-playwright-frontend-integration-tests.md).
- Root-level full-runtime transport/end-to-end tests use the real BFF and the
  documented runtime transport. They do not inherit the frontend suite's
  requirement to avoid backend or simulator.
- Before changing either suite, read the relevant architecture and accepted ADRs,
  including [reliability and testing](../architecture/reliability-and-testing.md).

## Test Quality

- Colocate tests with the module that owns the behavior, except where a suite's
  documented boundary requires a separate integration harness.
- Treat tests as protection for system behavior, not as coverage decoration.
- Choose the lowest test layer that credibly protects the risk; use a broader
  boundary only when the behavior depends on it.
- Exercise the public boundary appropriate to the test layer instead of
  bypassing it without a test-specific reason.
- Control time, data, IDs, randomness and synchronization deterministically. Do not use
  arbitrary waits where an observable event, assertion or explicit test seam
  can establish readiness.
- Validate data crossing shared contract boundaries with the owning shared
  contract before it can make a downstream assertion pass.
- Prefer tests that exercise documented behavior, domain invariants, failure
  modes and user-visible reliability risks.
- Write test suite and case descriptions as self-contained summaries of the
  behavior they protect. Avoid references to task, story or acceptance-criteria
  identifiers, since tests should remain understandable without task history.
- Cover important negative and boundary cases when they affect the touched
  behavior, such as malformed events, duplicate events, unsupported event types,
  lifecycle cleanup, ordering, limits, stale/offline state, timeouts and late
  confirmations.
- Avoid tests that pass trivially because assertions are too broad, only mirror
  implementation details, or do not fail when the behavior is broken.
- Avoid redundant tests that repeat the same scenario without covering a
  distinct risk.
