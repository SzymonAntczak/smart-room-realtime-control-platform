# Implementation Follow-ups

This list records deliberately deferred implementation work. It does not define
binding system behavior; promote a durable rule to architecture documentation or
an ADR as part of the related change.

## Open Follow-ups

### Stage 3.5 - Frontend Integration Test Reference Suite

- [x] Add `@playwright/test`, the browser binaries and a root `test:browser`
      script. Configure the suite for headless Chromium and retain trace,
      screenshot and video artifacts only when a test fails.
      Done when: `npm run test:browser` starts and runs one empty smoke test.

- [ ] Add `frontend/tsconfig.browser-tests.json` and a dedicated typecheck
      script for Playwright specs, the mock BFF and Playwright configuration.
      Keep browser-test and Node test-harness types out of the production
      frontend TypeScript program.
      Done when: browser-test type errors fail independently of the frontend
      application typecheck.

- [ ] Extend ESLint for browser-test files and the Node-based mock BFF. Apply
      Playwright-specific rules only in the browser-test scope and keep the
      production frontend lint configuration unchanged.
      Done when: the browser suite and mock BFF lint with their appropriate
      globals and test rules, including rejection of focused or skipped tests
      in the committed suite.

- [ ] Extend `frontend/AGENTS.md` with browser-integration-test guidance.
      State the test location, the mocked-BFF boundary, shared-contract
      validation, accessible locators, deterministic synchronization and the
      prohibition on direct frontend-state injection, simulator-native messages
      and arbitrary time waits.
      Done when: the local instructions complement the ADR without redefining
      command or reliability behavior owned by architecture documentation.

- [ ] Add Playwright configuration that starts the Vite frontend on a dedicated
      test port with `VITE_ROOM_REALTIME_URL` and `VITE_ROOM_COMMAND_URL`
      targeting the mocked BFF.
      Done when: a browser test loads the frontend from the test server; neither
      the production backend nor the simulator is started.

- [ ] Create a test-local mocked BFF server with `GET /room/realtime` as a
      persistent SSE endpoint and `POST /room/commands` as the command endpoint.
      Done when: a test can connect to SSE and make one command request through
      the same URLs the frontend uses in production.

- [ ] Validate mock-BFF snapshots, SSE messages and received command requests
      with the shared TypeBox contracts.
      Done when: invalid fixtures and unexpected `set.power` requests fail the
      test harness before they can make a UI assertion pass.

- [ ] Add deterministic LED fixtures: an online `led-main` snapshot, valid
      revision sequencing, and helpers for `commands.updated` and
      `device.updated` messages.
      Done when: browser scenarios can arrange BFF-level state without
      simulator-native messages or frontend-state injection.

- [ ] Add a browser test for accepted command and immediate confirmation.
      Done when: it proves that the old confirmed power remains visible while
      pending and the new power becomes confirmed only after the matching
      realtime update.

- [ ] Add a browser test for delayed confirmation.
      Done when: the test holds the command pending until an explicit mock-BFF
      release, shows visible progress and locked interaction, then confirms the
      update without wall-clock waiting.

- [ ] Add a browser test for explicit command rejection.
      Done when: a rejected command response produces an understandable visible
      failure and does not change confirmed power.

- [ ] Add a browser test for command timeout.
      Done when: an accepted command later receives a `timed_out` projection,
      the reported power remains unchanged, and the terminal outcome stays
      visible.

- [ ] Add a browser test for a late report after timeout.
      Done when: the late state report updates observed power but the earlier
      timed-out outcome remains visible and is not retroactively confirmed.

- [ ] Add a `smart-room-browser-integration-testing` skill after the mock BFF
      and LED scenarios establish a stable implementation pattern. Scope it to
      Playwright, the BFF contract boundary, deterministic SSE scenario control
      and relevant verification; do not duplicate durable system behavior.
      Done when: the skill refers to the ADR and architecture sources, and a
      new browser scenario can follow it without adding frontend-state injection
      or timing-dependent assertions.

- [ ] Document `npm run test:browser` in the frontend/repository test guidance
      and add it to CI when CI is introduced.
      Done when: contributors can run the deterministic Stage 3.5 reference
      suite locally and inspect artifacts for a failing browser test.

- [ ] Implement physical LED actuation according to the external-actuation ADR
      before Stage 6 hardware acceptance. A physical state report must update
      observed state even during a Dashboard command; a matching report confirms
      the requested outcome without asserting causal attribution, while a
      non-matching report leaves the command pending.
      Done when: simulator or hardware-adapter tests and UI tests cover physical
      actuation with no active command, matching and non-matching active
      commands, and a matching report after timeout.
