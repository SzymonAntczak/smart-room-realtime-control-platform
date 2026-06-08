# Frontend Instructions

These instructions apply to files under `frontend/`.

## Role

The frontend is the user-facing control surface for the Smart Room platform. It
must present the domain states defined by the architecture docs honestly.

Do not redefine event, command or reliability semantics here. Follow the root
`AGENTS.md` and the architecture docs.

## TypeScript

- Prefer `unknown` over `any`.
- Prefer discriminated unions for UI-visible lifecycle states.
- Use `as const`, `satisfies`, utility types and narrow type guards where they
  clarify intent.
- Avoid stringly typed UI state when a named type would better express the
  domain.

## React

- Use modern React with function components, hooks and composition.
- Keep derived UI state explicit and testable.
- Avoid duplicating realtime state into local component state unless there is a
  clear interaction reason.
- Keep component code focused on rendering documented projections instead of
  redefining domain semantics.

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
- Prefer `oklch()` for new color tokens unless existing tooling or design
  conventions require another format.
- Define shared colors as named CSS variables instead of scattering raw values.
- Keep state colors accessible and distinguishable.
- Keep layouts stable across state changes.

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
