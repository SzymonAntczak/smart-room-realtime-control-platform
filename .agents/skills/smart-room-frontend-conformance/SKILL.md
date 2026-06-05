---
name: smart-room-frontend-conformance
description: Use when auditing or reviewing Smart Room frontend structure, UI state behavior, module boundaries, frontend/shared contract usage, naming conventions, tests, or drift from frontend/AGENTS.md and architecture docs. Trigger for frontend conformance checks, docs-vs-frontend consistency reviews, UI state reliability audits, or deciding whether a frontend mismatch should be fixed in code, tests, docs, or an ADR.
---

# Smart Room Frontend Conformance

Use this skill to check whether the frontend still expresses the Smart Room
architecture honestly and keeps its module boundaries clear.

## Required Sources

Start with:

- `AGENTS.md`
- `frontend/AGENTS.md`
- `frontend/package.json`
- `frontend/eslint.config.js`
- `frontend/.prettierrc.json`
- `docs/architecture/control-loop.md`
- `docs/architecture/events-and-commands.md`
- `docs/architecture/devices.md`
- `docs/architecture/reliability-and-testing.md`
- `docs/decisions/adr-stage-1-local-runtime-and-repository-boundaries.md`
- `docs/decisions/adr-command-correlation-confirmation-and-concurrency.md`
- `docs/decisions/adr-device-command-confirmation-and-health-policy.md`

Then inspect the relevant frontend modules under `frontend/src`.

## Frontend Rules To Preserve

- `frontend/index.html` remains the Vite HTML entry.
- `frontend/src/main.tsx` and `frontend/src/globals.css` are bootstrap-level files.
- Product code lives under `frontend/src/app`.
- React component files use `PascalCase`.
- Non-component TypeScript files use `kebab-case`.
- Shared frontend UI under `frontend/src/app/shared` stays low-level and does not
  own Smart Room lifecycle semantics.
- Platform contracts belong in root `shared`, not duplicated in frontend-only
  type files.
- The frontend consumes room snapshots and realtime updates; it must not become
  the source of truth for device state or command lifecycle interpretation.
- Frontend components should render backend/shared projections for command
  lifecycle, health and command availability instead of re-deriving timeout,
  confirmation or degraded/offline command policy.
- External realtime/backend payloads should be validated at frontend boundaries
  before rendering when runtime data crosses from outside the TypeScript process.
- Fixtures should include reliability scenarios, not only happy paths.
- UI must keep requested, reported, pending, confirmed, failed, timed-out, stale
  and offline states distinguishable when user-visible.

## Audit Workflow

1. Build a compact source-of-truth summary from the required docs.
2. Inspect touched frontend files and nearby modules.
3. Compare module boundaries, naming and UI behavior against the rules above.
4. Classify mismatches:
   - `code drift`: frontend contradicts current docs or AGENTS rules
   - `structure drift`: files or modules are placed against the intended shape
   - `contract drift`: frontend duplicates or redefines shared platform semantics
   - `projection drift`: frontend re-derives lifecycle or availability decisions
     that should come from backend/shared projections
   - `test gap`: important user-visible frontend behavior lacks coverage
   - `decision gap`: behavior is ambiguous and needs docs or ADR context
5. Prefer concrete findings with file and line references.
6. Do not change code during a conformance audit unless the user explicitly asks
   for fixes.

## Expected Output

Lead with findings ordered by severity. For each finding include:

- classification
- evidence from docs, AGENTS or ADRs
- evidence from frontend code, tests or missing coverage
- recommended next action

If no findings are found, say so clearly and list residual risks.
