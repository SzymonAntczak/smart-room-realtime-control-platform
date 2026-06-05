---
name: smart-room-frontend-implementation
description: Use when implementing Smart Room frontend changes in React, TypeScript and Vite, especially changes under frontend/src, frontend module structure, realtime client boundaries, UI components, frontend shared utilities, tests, linting, formatting, or package scripts.
---

# Smart Room Frontend Implementation

Use this skill when changing the frontend codebase.

## Read First

Read the relevant parts of:

- `frontend/AGENTS.md`
- `frontend/package.json`
- `frontend/eslint.config.js`
- `frontend/.prettierrc.json`
- `frontend/tsconfig.json`
- root `shared/src/contracts.ts` when working with platform contracts
- architecture docs when behavior touches command lifecycle, device health,
  realtime state or event history

## Structure Rules

- Keep `frontend/index.html` as the Vite HTML entry.
- Keep `frontend/src/main.tsx` and `frontend/src/globals.css` as bootstrap files.
- Put app code under `frontend/src/app`.
- Prefer domain modules under `frontend/src/app`, for example:
  - `room-control`
  - `room-realtime`
  - `led-control`
  - `sensors`
  - `event-feed`
  - `shared`
- Use `frontend/src/app/shared` only for low-level frontend concerns.
- Do not put Smart Room lifecycle semantics into shared UI primitives.
- Put domain-specific status mapping close to the domain module that owns the
  meaning.
- Keep root `shared` for platform contracts shared across project boundaries.
- Prefer importing platform contracts through the frontend domain module that
  owns the view model instead of scattering direct root `shared` imports through
  presentational components.
- Validate external realtime/backend payloads at the frontend boundary before
  rendering them. Runtime schema validation belongs near WebSocket, HTTP,
  storage or fixture boundaries, not inside presentational components.

## Naming And Style

- React component files use `PascalCase`.
- Non-component TypeScript files use `kebab-case`.
- Follow Prettier settings: single quotes, tab width 4, trailing commas.
- Prefer `unknown` over `any`.
- Prefer named lifecycle states and discriminated unions over generic booleans
  when the UI state is user-visible.

## Behavior Rules

- Commands are requests, not proof of device state.
- The frontend should send command intent and render backend projections.
- Do not derive command confirmation from requested state in frontend code.
- Do not re-derive command lifecycle, timeout completion, device health policy
  or command availability when those values should come from backend/shared
  projections.
- Keep reported state separate from requested state.
- Make pending, failed, timed-out, stale and offline states visible.
- Respect backend-provided command availability or projection fields.
- Fixture clients are acceptable for tests and demos, but should be explicit and
  include reliability scenarios such as pending, failed, timed-out, stale,
  offline, degraded, reconnect and late-report behavior when relevant.

## Implementation Workflow

1. Inspect existing frontend structure and scripts before editing.
2. Make the smallest module move or code change that preserves ownership.
3. Update imports and ESLint naming patterns when moving modules.
4. Add or update tests for user-visible reliability behavior when behavior
   changes.
   - Place tests near the module that owns the behavior.
   - Name tests after user-visible behavior, not implementation details.
5. Run the narrowest useful checks, usually:
   - `npm.cmd run lint`
   - `npm.cmd run typecheck`
   - `npm.cmd test`
   - `npm.cmd run format`
6. Report any command that could not be run.

## Avoid

- Recreating broad `components`, `types`, `utils` or `services` folders.
- Moving domain logic into `shared` just because two files import it.
- Treating fixture data as the production realtime path.
- Hiding stale/offline/failed/timed-out states behind generic loading or error
  labels.
