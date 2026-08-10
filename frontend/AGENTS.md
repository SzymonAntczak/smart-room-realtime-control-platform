# Frontend Instructions

These instructions apply to files under `frontend/`.

## Role

The frontend is the user-facing control surface for the Smart Room platform. It
must present the domain states defined by the architecture docs honestly.

Do not redefine event, command or reliability semantics here. Follow the root
`AGENTS.md` and the architecture docs.

## TypeScript

Follow the root TypeScript rules. For frontend-specific code, prefer named
types for UI-visible lifecycle states and keep domain-facing state explicit
enough to render documented behavior honestly.

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

- Place tests near the module that owns the behavior.
- Domain UI behavior tests belong near `frontend/src/app/<domain>`.
- Shared UI tests belong near `frontend/src/app/shared/ui`.
- Global test setup belongs under `frontend/src/test`.
- Test names should describe user-visible behavior, not implementation details.
- Prioritize tests for documented user-visible behavior over implementation
  details.

## Behavior Checks

Before treating frontend behavior work as done, verify the relevant architecture
and ADR acceptance criteria instead of relying on duplicated checklists here.

## Architecture Decision Triggers

- Check architecture docs and ADRs before changing user-visible lifecycle
  states, command availability rules, stale/offline/degraded interpretation,
  command confirmation behavior or timeout behavior.
- Update architecture docs or create an ADR when the behavior rule changes.

## Verification

Before finishing frontend changes:

- Check available scripts in `frontend/package.json`.
- Run the narrowest relevant check.
- If no relevant check exists, say so explicitly.
- When a requirement concerns production bundle exclusion, tree-shaking or
  build-time code removal, rendering tests are insufficient. Verify the
  production build artifact or module graph.
