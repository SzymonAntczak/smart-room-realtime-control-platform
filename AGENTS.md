# Smart Room Realtime Control Platform

Local-first realtime/IoT platform that makes device state, user intent, time,
uncertainty and failure visible. AI assists implementation; humans own architecture.

## Context And Authority

- Start with `README.md` and `docs/README.md`.
- `docs/architecture/` and accepted ADRs in `docs/decisions/` bind system
  behavior unless the user explicitly asks to change it. Read relevant sources
  before changing behavior; resolve drift between docs, code, tests and examples
  explicitly and update architecture or decisions when intended behavior changes.
- For documentation authority, planning context and AI delivery policy, read
  `docs/architecture/ai-collaboration.md` when planning, implementing or reviewing
  a change.

- When editing documentation, follow the standalone target-architecture and ADR
  policy in [docs/README.md](docs/README.md#documentation-policy).
- Do not create or append task-completion, acceptance-run or review reports in
  the repository; follow [delivery output](docs/architecture/ai-collaboration.md#delivery-output).

## Code And Tests

When changing or reviewing code, module boundaries or tests, read the relevant
sections of `docs/development/coding-guidelines.md` and local `AGENTS.md`. The
guide owns TypeScript, structure, imports, test quality, test-suite boundaries
and verification conventions. For frontend code, styles, fixtures or tests,
also read the relevant sections of `docs/development/frontend-guidelines.md`.

## Working And Completion

- Keep changes small and explainable; broad refactors must support the request.
- Use `smart-room-review-workflow` for reviews; binding docs and repository
  guidance remain the criteria.
- Continue authorized reversible local work without repeated approval. Preserve
  the one-writer, Specification Lock and independent delivery-gate rules from
  `ai-collaboration.md`; commit only when explicitly requested.
