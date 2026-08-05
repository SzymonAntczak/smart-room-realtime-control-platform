# Implementation Follow-ups

This list records deliberately deferred implementation work. It does not define
binding system behavior; promote a durable rule to architecture documentation or
an ADR as part of the related change.

## Stage 3 — Simulated LED Command Reference Slice

These are deliberately small, ordered implementation tasks for the first
controllable-device reference slice. They do not change the binding command
rules already documented in architecture and accepted ADRs.

- [x] **S3.0 — Decide the command transport and operational LED defaults**
  - Scope: Decide the frontend-to-BFF command boundary (HTTP request or a new
    WebSocket direction), the `set.power` timeout, `recentCommands` bound and
    the names and expected behavior of LED simulator scenarios. Promote any
    durable decision to architecture documentation or an ADR.
  - Depends on: Stage 2.5 manual acceptance loop.
  - Done when: An implementer has documented transport, timeout, retention and
    scenario choices without having to infer system rules.

- [ ] **S3.1 — Extend shared command and realtime contracts**
  - Scope: Define TypeBox contracts for the chosen command transport and for
    active and terminal command projection updates, while preserving the
    existing `set.power`, `activeCommands` and `recentCommands` invariants.
  - Depends on: S3.0.
  - Done when: Contract tests accept valid command and realtime messages and
    reject malformed or semantically inconsistent shapes.

- [ ] **S3.2 — Add the simulator-native LED model and repeatable scenarios**
  - Scope: Add an LED state report and `set.power` behavior to the simulator,
    including normal confirmation, delayed confirmation, explicit rejection,
    timeout/no confirmation and late-report scenarios.
  - Depends on: S3.0.
  - Done when: Simulator tests deterministically cover native messages,
    commands and scenario timing; the simulator remains device-like and does
    not own platform command lifecycle rules.

- [ ] **S3.3 — Add the backend LED adapter and command dispatch path**
  - Scope: Translate platform `set.power` commands to simulator-native
    commands and LED reports to `device.state.reported`; compose the adapter in
    the local runtime without exposing simulator protocol details to platform
    code.
  - Depends on: S3.1 and S3.2.
  - Done when: Adapter tests verify both translations and an integration test
    exercises command → simulator → report → event processor.

- [ ] **S3.4 — Implement command lifecycle and backend projections**
  - Scope: Project accepted, pending, confirmed, failed and timed-out commands;
    enforce one active command per device; match `set.power` reports; maintain
    bounded terminal history; preserve a timeout when a matching report is
    late.
  - Depends on: S3.1 and S3.3.
  - Done when: State-model tests cover confirmation, rejection, active-command
    conflict, timeout and late report without turning a timed-out command back
    into a confirmed command.

- [ ] **S3.5 — Expose command handling and command projections through the BFF**
  - Scope: Implement the selected BFF command boundary, validation and dispatch
    to the platform, plus documented realtime snapshot and delta delivery for
    active and terminal command projections.
  - Depends on: S3.1 and S3.4.
  - Done when: BFF tests cover valid and invalid requests, initial snapshot,
    sequential projection updates and rejection of undocumented message shapes.

- [ ] **S3.6 — Build the LED control UI and command outcome history**
  - Scope: Add a LED control surface with UI-side `submitting`, visible
    pending/failed/timed-out states, stale-state warning and terminal command
    history; keep requested state visibly distinct from confirmed device state.
  - Depends on: S3.5.
  - Done when: Frontend tests prove that a requested power state is never shown
    as confirmed before a device report and terminal outcomes remain
    understandable.

- [ ] **S3.7 — Verify the reference loop and document manual acceptance**
  - Scope: Add a runtime-level integration test and a manual acceptance
    checklist for normal, delayed, rejected, timed-out and late-report flows.
  - Depends on: S3.2 through S3.6.
  - Done when: The full bidirectional loop is repeatable in the simulator and
    meets the Stage 3 completion criteria in the roadmap.

## General Follow-ups

These are remaining implementation tasks that are not currently assigned to a
specific roadmap stage.

- [x] Remove obsolete code and compatibility paths. The supported realtime and
      development-scenario contracts describe only the current behavior.

- [x] Remove short event history from realtime projections and dashboard cards.
      The dashboard shows only current device values. Event history and a
      per-sensor details entry point are deferred to a dedicated future slice.
      The realtime contract, projections, frontend and binding architecture/ADR
      documentation are aligned.

- [x] Add a second simulated temperature sensor and cover two simultaneous
      temperature sensors end-to-end. Verify independent cadences, health,
      device-scoped scenario controls and per-device realtime updates without
      unnecessary updates to the other sensor card.

- [ ] Migrate the server-to-client realtime BFF stream from WebSocket to SSE.
      First record and accept an ADR that confirms SSE is the intended durable
      transport. Preserve the room snapshot baseline, revision-linked updates,
      boundary validation and visible reconnect behavior; keep all frontend
      command requests on explicit HTTP boundaries.
      Done when: the BFF, shared transport contracts, frontend realtime client,
      architecture documentation and focused reconnect/contract tests use SSE,
      and no application command ingress is accepted through the realtime
      stream.

- [ ] Implement physical LED actuation according to the external-actuation ADR
      before Stage 5 hardware acceptance. A physical state report must update
      observed state even during a Dashboard command; a matching report confirms
      the requested outcome without asserting causal attribution, while a
      non-matching report leaves the command pending.
      Done when: simulator or hardware-adapter tests and UI tests cover physical
      actuation with no active command, matching and non-matching active
      commands, and a matching report after timeout.

- [ ] Define runtime device-membership behavior for devices added or removed
      while a frontend realtime connection is active. The current slice assumes
      a fixed configured device set for the connection lifetime; decide whether
      this needs device lifecycle deltas or an explicit snapshot refresh.

- [ ] Evaluate selective realtime subscriptions and device filters when room
      size, multiple room views or telemetry volume make the all-devices room
      stream insufficient. Keep the initial room snapshot atomic with the
      chosen subscription scope.
