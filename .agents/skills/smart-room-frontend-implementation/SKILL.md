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
- root `.prettierrc.json`
- `frontend/tsconfig.json`
- root `shared/src/contracts.ts` when working with platform contracts
- architecture docs when behavior touches command lifecycle, device health,
  realtime state or event history

## Implementation Workflow

1. Inspect existing frontend structure, instructions and scripts before editing.
2. Summarize the relevant frontend instruction or architecture source in your
   working notes before changing behavior.
3. Make the smallest module move or code change that preserves documented
   ownership.
4. Update imports and lint configuration when moving modules.
5. Add or update tests for user-visible documented behavior when behavior
   changes.
6. Run the narrowest useful checks from `frontend/`, usually:
    - `npm run lint`
    - `npm run typecheck`
    - `npm test`
    - `npm run format`
7. Report any command that could not be run.

## Avoid

- Repeating frontend rules from `frontend/AGENTS.md` inside this workflow.
- Repeating domain behavior from architecture docs or ADRs inside this workflow.
- Broad refactors that are not needed for the requested frontend change.
