---
name: smart-room-browser-integration-testing
description: Use when adding, changing or reviewing Smart Room Playwright browser-integration tests, the test-local mocked BFF, browser-test runtime or Playwright configuration under frontend/tests/browser-integration. Use for mocked-BFF browser scenarios, not root-level full-runtime end-to-end tests.
---

# Smart Room Browser Integration Testing

Use this skill for the mocked-BFF Playwright suite.

## Read First

Read the relevant parts of:

- `frontend/AGENTS.md`
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

## Keep Boundaries Intact

- Start only Vite and the test-local mocked BFF for this suite.
- Do not start the production backend or simulator.
- Do not inject frontend state or use simulator-native messages to arrange a
  scenario.
- Do not use arbitrary time waits; release or observe a deterministic condition.
- Do not use CSS selectors or DOM structure as browser locators.
- Do not redefine system behavior here. Refer to the architecture documents and
  accepted ADRs that own it.

The mocked-BFF rules above do not apply to the separate root-level full-runtime
end-to-end suite.
