# Frontend Instructions

Applies to `frontend/`. The frontend renders documented domain state honestly;
it does not redefine event, command or reliability semantics.

## Context

Follow root `AGENTS.md`. When changing or reviewing frontend code, styles,
fixtures or tests, read the relevant sections of
`docs/development/frontend-guidelines.md` (paths there are relative to frontend).
It owns React, component-prop, CSS, accessibility, dev-tooling, fixture,
refactoring, behavior-decision and test conventions. For verification, use its
Verification section and the shared coding guide.

## Browser Integration

For `tests/browser-integration` and its runtime/configuration use
`smart-room-browser-integration-testing`, the guide's Browser Integration Tests
section, `docs/decisions/adr-playwright-frontend-integration-tests.md` and
`docs/architecture/reliability-and-testing.md`.

For the distinction from root-level full-runtime tests, use Test Suite Boundaries
in `docs/development/coding-guidelines.md`.
