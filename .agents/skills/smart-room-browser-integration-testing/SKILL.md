---
name: smart-room-browser-integration-testing
description: Add or review Smart Room mocked-BFF Playwright scenarios and their harness/configuration. Applies to frontend browser integration, not root-level full-runtime end-to-end tests.
---

# Smart Room Browser Integration Testing

Use this skill for the mocked-BFF Playwright suite.

## Read First

Read the relevant parts of:

- `frontend/AGENTS.md`
- [frontend guidelines](../../../docs/development/frontend-guidelines.md#browser-integration-tests),
  Browser Integration Tests section
- `docs/decisions/adr-playwright-frontend-integration-tests.md`
- `docs/architecture/reliability-and-testing.md`
- root `package.json`, `frontend/package.json` and `playwright.config.ts`
- the closest existing spec, mock-BFF fixture and shared contract for the
  scenario

Read `docs/architecture/` and accepted ADRs when the requested scenario touches
command lifecycle, availability, freshness, health or history behavior.

## Workflow

1. Classify the work as mocked-BFF browser integration or root-level full-runtime
   end-to-end testing. Apply this skill only to the former.
2. Identify the documented, user-visible behavior and its risk before choosing
   the test scenario.
3. Inspect the nearest browser spec and mock-BFF helpers. Keep scenario setup at
   the frontend-facing BFF boundary: schema-valid snapshots, command responses
   and revision-linked SSE messages.
4. Add or extend test-only mock-BFF controls when the browser scenario needs a
   deterministic state transition. Add mock-BFF unit tests when changing
   fixtures, contract validation, SSE serialization or revision sequencing.
5. Drive the Dashboard through accessible Playwright locators. Synchronize with
   observable UI state, requests, responses or explicit scenario control.
6. Assert user-visible Dashboard behavior, rather than mock endpoints or
   implementation details of the mock BFF.
7. Run the narrowest relevant checks:
    - `npm run typecheck:browser`
    - `npm run test:browser`
    - `npm run test:frontend` when changing mock-BFF unit tests
    - relevant lint or format checks

Apply the browser-suite conventions from the linked frontend guidelines throughout
this workflow. Architecture documents and accepted ADRs own system behavior.
