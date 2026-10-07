# Frontend Development Guidelines

Read the relevant sections when changing or reviewing frontend code, styles,
fixtures or tests. Follow the shared [coding guidelines](coding-guidelines.md).
Architecture and accepted ADRs remain binding for product behavior. Paths in
these conventions are relative to frontend/ unless stated otherwise.

## TypeScript

Follow the TypeScript section of the shared coding guide. Prefer named
types for UI-visible lifecycle states and keep domain-facing state explicit
enough to render documented behavior honestly.

## Application Structure And Imports

Organize `src/app` by responsibility:

- `api/<resource>` owns production HTTP/SSE transport, endpoint configuration,
  request construction, response validation and room-stream synchronization.
  Group related operations by resource; each module exposes a small `index.ts`
  API. There is no aggregate `api/index.ts`. API modules do not depend on React,
  features, pages, application composition or development tooling.
- `pages/<page>` composes one screen and owns its local components, hooks,
  supporting models, sessions, tests and layout interactions. Dashboard owns LED
  controls, temperature readings and its history panel, session and pagination.
  Pages do not import other pages.
- `features/<module>` owns a cohesive business module with actual reuse by
  multiple consumers. Shared modules include date-time formatting. Reuse across independent modules
  on one page counts; hypothetical future reuse and tests alone do not. Keep
  page-specific state and presentation code with its page. Production transport
  belongs in `api`.
- `ui/<component>` owns a basic reusable UI component, its styles and tests.
  Keep shared presentation primitives directly under `app/ui` instead of
  `features`.
- The page that renders the live room owns its shared room connection and binds
  room updates to its history source. Dashboard owns `useRoom`; `App.tsx` and
  development `AppDev` render the same Dashboard, and development composition
  extends it through `getDeviceExtension` and the `renderOverlay` slot.
- `dev` owns development tooling and may compose production public APIs.
- `src/main.tsx` owns bootstrap and build-mode selection.

The room API owns SSE, validation, revisions, reconnect and the current BFF
snapshot, including its bounded feed. Dashboard's `useRoom` owns renderable room
state and maps its device projections for rendering. Dashboard's device cards
own their renderable device projection types. Dashboard owns device display
names and its room history update contract, source port and connection bridge.
The history API owns HTTP clients and response validation for user history. Dashboard history owns history presentation, sessions, pagination
and virtual rendering. Dashboard's room hook publishes validated history
updates before the new room view.

Keep each module's API small, with named exports through its designated entrypoint.
Features and API resources use `index.ts`; the dashboard exposes only
`pages/dashboard/Dashboard.tsx`, including `DeviceControlExtension`, and has no
`index.ts`. Import that page directly through `pages/dashboard/Dashboard`; its
`RenderableDeviceProjection` type is also available there for development
composition, while components and hooks remain private. Other page entrypoints
retain their existing conventions. Application i18n configuration and translations live in
`app/i18n`; reusable timestamp formatting is exposed through
`features/date-time` without coupling consumers to initialization.
Import another module through its public API; within the same module, import files
directly instead of its own entrypoint. Use relative imports and colocate tests
and CSS Modules with their owner. Do not export test helpers through production
entrypoints or retain forwarding modules at old paths.

Keep declarations private by default. Export a function, type, interface, class
or constant only when another production module consumes it or when it is a
required entrypoint loaded by tooling. An export that is unused or consumed only
by test code must remain private; tests should exercise the behavior through the
owning module's production-facing boundary. Types used only in an exported
signature can remain private when consumers rely on inference.
Re-export a symbol through a public entrypoint only when that entrypoint has a
consumer for the symbol; an unused re-export is not a reason to keep a declaration
exported. Check named, namespace and dynamic imports before removing exports,
and remove obsolete exports and re-exports when their last consumer disappears.
Do not export declarations for hypothetical future reuse.

Give each ordinary component a dedicated kebab-case folder matching its PascalCase
name: `temperature-card/TemperatureCard.tsx`. Name its colocated test and
CSS Module `TemperatureCard.test.tsx` and `TemperatureCard.module.css`.
The folder owns that component, its hooks, styles and tests;
child components have their own folders. Keep module entrypoints at the
page or feature boundary rather than adding an `index.ts` to every component folder.
Nest private component folders under the component that owns their composition:
the history sidebar owns its content, which owns the history feed and its item.

Name custom-hook files in camelCase matching the exported hook, including tests:
`useLedCommandRequest.ts` and `useLedCommandRequest.test.tsx`. Other non-component modules retain
kebab-case names. These conventions apply to new or modified code; migrate older
areas incrementally rather than renaming the entire frontend as a prerequisite.
Updating imports alone does not require migrating the importing component or hook.
ESLint enforces camelCase hook filenames throughout the frontend.

Frontend-owned history modules and symbols use `History`/`history`. Imported
`UserHistory` contracts, BFF `userHistory` fields and the
`/room/history/user-history` endpoint keep their protocol names. Telemetry
history keeps its separate `TelemetryHistory` names.

Keep small helpers used by one owner private in that owner's module. Components
and hooks own their dedicated pure view models and stateful sessions as colocated
non-React modules, with their tests. Shared state modules remain in their owning
feature. Production HTTP/SSE clients belong in API resource modules. Do not
introduce a hook merely to wrap a pure mapping or to reduce the number of files.

| Importing area          | Allowed dependencies outside its own module                             |
| ----------------------- | ----------------------------------------------------------------------- |
| `api/<resource>`        | Shared contracts and public APIs of other API resources, without cycles |
| `features/<module>`     | Public API resource APIs and other feature APIs, without cycles         |
| `ui/<component>`        | Public APIs of other UI components                                      |
| `pages/<page>`          | Public feature, API resource and UI APIs                                |
| Application composition | Public page, feature, API resource and UI APIs                          |
| `dev`                   | Public page/feature/API resource/UI APIs                                |

Features must not import pages or application composition; pages must not import
other pages or application composition. Application composition exposes only
`App.tsx` to bootstrap. Dashboard's `useRoom` remains private to the page, with
its room/history bridge inline in the hook.

External libraries and `@smart-room/contracts` follow the existing contract and
package boundaries. Production modules must not import test-only code or global
test setup. Dashboard's page modules consume its shared room connection;
opening a history panel does not create a separate SSE stream.

The production-to-dev exception is a dynamic import in `src/main.tsx` inside
`if (import.meta.env.DEV)`. See Development-Only Features for bundle requirements.
These import boundaries are project guidance and are not checked by a custom ESLint rule.
Cross-module private access in tests is allowed only through `vi.mock`/`vi.importActual`.
These exceptions never apply to production.
Tests may import reusable fixtures and mocks from `src/test`; production modules
must not import that directory. Shared test modules retain the application
module directions and public API rules when importing production code, and do
not re-export production implementations. Room/history composition tests belong
near `frontend/src/app/pages/dashboard/useRoom.ts`.

## React

- Use modern React with function components, hooks and composition.
- Define exactly one React component per `.tsx` file. Extract sibling,
  nested or helper components into their own clearly named files; keep only
  types, constants and non-component helpers that directly support that one
  component in the same module.
- Exception: a compound component may keep its tightly coupled child components
  in the same `.tsx` file when they form one cohesive public API. Keep the
  children private or expose them only through the compound component, and use
  one colocated CSS Module for that compound feature.
  This exception also permits those children to share the compound component's
  folder; ordinary sibling or child components still need dedicated folders.
- Keep derived UI state explicit and testable.
- Avoid duplicating realtime state into local component state unless there is a
  clear interaction reason.
- Keep component code focused on rendering documented projections instead of
  redefining domain semantics.
- Give each component, hook and module one cohesive responsibility. Pass data
  and actions to presentational components through props; keep realtime,
  transport and contract-adaptation integration in domain hooks or modules.
- Keep external-source dependencies at module boundaries so UI behavior can be
  tested without transport. Extend behavior through composition and small,
  explicit contracts instead of growing conditional components; do not add
  abstractions, interfaces or indirection without a second real use.
- Keep interaction, transport and domain-specific state transitions in a named
  hook. Components should orchestrate hooks and render state through props;
  do not embed that business logic directly in JSX components.

## Contract Boundary

- Root `shared/src` is the source of platform contracts shared across project
  boundaries.
- Prefer importing platform contracts through the frontend domain module that
  owns the view model instead of scattering direct imports from root `shared`
  through presentational components.
- Keep frontend-only view additions, such as connection status, close to the
  domain module that adapts platform projections for rendering.
- Validate external realtime or backend payloads at the frontend boundary before
  rendering them. Prefer schema validation near the realtime client instead of
  inside presentational components.
- Runtime schema validation, for example with Zod, belongs at boundaries such as
  WebSocket, HTTP, storage or fixture data that simulates backend payloads. Do
  not duplicate schemas in components.

## Development-Only Features

- Production frontend modules must not import from `src/app/dev` or depend on
  development-only contracts, types, components or hooks.
- Development tooling may compose and decorate production components, but the
  dependency must never point from production code into development tooling.
- Keep development-only features outside the production dependency graph. Gate
  them at a build-time boundary such as the application bootstrap using
  `import.meta.env.DEV` and dynamic imports when appropriate.
- Do not rely on runtime props to exclude development-only modules from the
  production bundle.

## Component Contracts

- Keep component props expressed in terms of the component's own responsibility.
  Do not expose unrelated features through reusable production component APIs.
- Prefer neutral composition points such as `headerAction`, `footer` or
  `actions` over feature-specific props.
- Resolve environment/build-mode decisions near the application bootstrap
  instead of threading them through production components.
- Do not make props optional without a reachable UI state that requires their
  absence. Model loading or missing entities in the component that owns that
  state.
- When several projection fields are repeatedly combined to derive display
  state or interaction behavior, prefer a pure domain-to-view mapping function.
  Do not introduce view models for trivial components.

## Refactoring

- After restructuring conditional or derived-state logic, remove branches,
  fallbacks and compatibility paths that have become unreachable or redundant.
  Every remaining branch should represent a distinct reachable behavior.

## Fixtures And Demo Data

- Fixture clients should demonstrate representative documented behavior, not
  only happy paths.
- Fixtures may provide controlled snapshots for UI development and tests, but
  they must not become the production source of command lifecycle semantics.

## HTML and Accessibility

- Prefer semantic HTML.
- Use real interactive elements before custom roles.
- Preserve keyboard navigation and visible focus states.
- Icon-only controls need accessible names.
- Do not rely on color alone to communicate state.

## CSS

- Use modern CSS: CSS variables, logical properties, grid, flexbox, container
  queries, `clamp`, `min`, `max` and `:has` where appropriate.
- Prefer relative units such as `rem` and `em` for spacing, sizing, breakpoints
  and radii. Prefer logical properties such as `inline-size`, `block-size`,
  `min-block-size`, `padding-block` and `padding-inline` over physical
  properties such as `width`, `height`, `padding-left` or `margin-top`.
- Prefer `oklch()` for new color tokens unless existing tooling or design
  conventions require another format.
- Define shared colors as named CSS variables instead of scattering raw values.
- Define shared spacing, radius and border-size values as named CSS variables
  in `src/globals.css` instead of scattering repeated raw values through
  component styles.
- Define shared typography and shadow values as named CSS variables in
  `src/globals.css`; keep component classes semantic and apply those tokens
  locally instead of introducing global utility classes before real reuse.
- Use existing design tokens from `src/globals.css` before introducing raw
  values in component styles. Add a new token when a value represents reusable
  visual language; keep raw values local only for one-off component constraints.
- Prefer CSS for visual effects, transitions, responsive behavior, hover/focus
  states and layout adaptations when they do not require application state,
  domain logic or DOM measurement. Use JavaScript only when the behavior cannot
  be expressed reliably in CSS.
- Keep state colors accessible and distinguishable.
- Keep layouts stable across state changes.
- A component that owns CSS must have a colocated CSS Module with the same base
  name (for example, `DeviceScenarioTrigger.tsx` and
  `DeviceScenarioTrigger.module.css`). Do not import one component's CSS Module
  from another component. Share visual tokens globally or introduce an explicit
  shared UI component when reusable markup and styles are both needed.

## Linting and Formatting

- Use ESLint for code quality and correctness.
- Use Prettier for formatting.
- Prefer separate scripts for linting, formatting, typechecking and tests unless
  the project already has another convention.
- Before changing lint or formatting setup, check the existing frontend manifest
  and config files.

## Testing

- Domain UI behavior tests belong near their owner in
  `frontend/src/app/features/<domain>` or `frontend/src/app/pages/<page>`.
- Feature and API client tests belong near their module; tests composing room and history belong
  near `frontend/src/app/pages/dashboard/useRoom.ts`. A translation
  test that renders a UI component belongs with that component.
- Shared UI tests belong near their component under `frontend/src/app/ui`.
- Global test setup and genuinely reusable fixtures or mocks belong under
  `frontend/src/test`, grouped by domain in ordinary kebab-case modules.
- Keep small scenario-specific helpers and mocks private in their test file.
  Do not create `*.test-support.*` files in `src/app` or expose helpers through
  production entrypoints; ESLint rejects those filenames.
- Hook tests use the hook's camelCase filename, even when rendering requires
  `.test.tsx`.

Follow Test Quality in the shared coding guide for test intent and naming.

## Browser Integration Tests

- Place Playwright specs under `frontend/tests/browser-integration`.
- Start only the Vite frontend and a test-local mocked BFF. The frontend must
  use the production-facing HTTP and SSE URLs against that BFF; do not start the
  production backend or simulator.
- Treat the mocked BFF as the browser suite's runtime boundary. Validate its
  snapshots, realtime messages and received command requests with contracts
  from `shared` before a UI assertion can rely on them.
- Drive and assert the UI through accessible browser locators. Synchronize with
  observable UI state, assertions or explicit mocked-BFF scenario control; do
  not use arbitrary time waits.
- Declare a fixed browser locale. Do not make browser scenarios depend on full
  translated sentences; cover translations in i18n or component tests instead.
- Prefer roles, accessible names and ARIA state for browser locators. Use a
  named `data-testid` only to identify a stable domain element when semantics
  alone are insufficient, and still assert its role or ARIA state when that is
  the user-visible behavior. Do not use CSS selectors or DOM structure.
- Separate mock-BFF unit tests protect only harness validity: fixtures,
  shared-contract validation, SSE formatting and revision sequencing. Playwright
  may use its test-only scenario controls to arrange BFF state, but must assert
  dashboard behavior rather than mock endpoint responses or mock implementation details.
- Browser-integration tests do not verify BFF behavior. They assume the mocked
  BFF provides schema-valid, revision-consistent frontend-facing responses;
  production BFF behavior belongs to backend unit and native-source-mocked
  integration tests. Root-level E2E smoke protects the real system composition.
- Do not inject React or other frontend state directly, and do not use
  simulator-native messages to arrange a browser scenario.
- Follow [ADR: Playwright for Frontend Integration Tests](../decisions/adr-playwright-frontend-integration-tests.md)
  and [Reliability and Testing](../architecture/reliability-and-testing.md)
  for the binding test boundary and system behavior. Do not redefine command
  lifecycle or reliability semantics here.

## Architecture Decision Triggers

- Check architecture docs and ADRs before changing user-visible lifecycle
  states, command availability rules, stale/offline/degraded interpretation,
  command confirmation behavior or timeout behavior.
- Update architecture docs or create an ADR when the behavior rule changes.

## Verification

Follow Verification in the shared coding guide, using `frontend/package.json`
for frontend commands. When a requirement concerns production bundle exclusion,
tree-shaking or build-time code removal, rendering tests are insufficient. Verify
the production build artifact or module graph.
