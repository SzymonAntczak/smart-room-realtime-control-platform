# Implementation Follow-ups

This list records deliberately deferred implementation work. It does not define
binding system behavior; promote a durable rule to architecture documentation or
an ADR as part of the related change.

## Open Follow-ups

### Stage 4 - Simulator Platform Readiness

Stage 4 turns the existing temperature and LED reference slices into a
trustworthy local platform. The target is durable, bounded history and
explainable operation without full event sourcing or a new MQTT runtime.

#### Architecture and persistence

- [ ] Record the Stage 4 storage and observability ADR.
      Define SQLite as the local storage implementation; distinguish accepted
      facts, raw telemetry, quarantined inputs, persisted current projections
      and JSON operational logs. Update the affected architecture documents,
      realtime ADR and roadmap to state that diagnostics are API/log based, not
      a Dashboard feature.
      Done when: retention, ordering, storage-failure behavior, restart recovery
      and transport responsibilities are unambiguous.

- [ ] Add a replaceable backend storage port and SQLite migrations.
      Use local `node:sqlite`, a gitignored database file and schema-versioned,
      deterministic migrations. Store accepted facts, telemetry, quarantine and
      the latest room projection; add indexes for device/time history reads.
      Done when: an empty or prior database migrates safely and tests can create
      isolated temporary databases.

- [ ] Persist accepted facts atomically before publishing their effects.
      In one transaction append the fact, write telemetry when applicable,
      enforce retention, and persist the derived room projection. On SQLite
      failure, do not update the renderable projection or emit realtime updates;
      write a correlated operational error log instead.
      Done when: tests prove fail-closed behavior, transaction rollback,
      exclusion of ignored inputs and preservation of late-report semantics.

- [ ] Restore runtime state and command timers from SQLite at startup.
      Rehydrate the latest projection and active commands. Reschedule the
      remaining command timeout, or emit a terminal timeout immediately when
      its deadline passed during downtime.
      Done when: restart tests retain state/history and never reconfirm a command
      that was already timed out.

#### Observability and contracts

- [ ] Configure structured backend logging.
      Configure Fastify/Pino for JSON stdout with `LOG_LEVEL`, correlation
      fields (`eventId`, `commandId`, `deviceId`, `source`, `reason`) and
      redaction of authentication/cookie fields. Logs must not become the domain
      history or a database table.
      Done when: startup, migration, rejected input, command handling and
      storage failure are logged safely and can be correlated with facts.

- [ ] Define shared history contracts and validation.
      Add TypeBox schemas for a bounded newest-first recent-event feed,
      cursor-based raw telemetry pages and durable diagnostics. Preserve the
      separate 20-entry `recentCommands` contract.
      Done when: contract tests reject malformed, unordered, over-limit,
      timestamp-inconsistent and dangling entries.

- [ ] Apply Stage 4 retention rules in storage reads and writes.
      Retain data for at most 30 days and enforce hard caps: 10,000 raw telemetry
      samples per device, 5,000 accepted facts and 1,000 quarantine records.
      Do not aggregate old raw telemetry; the 10,000-sample cap is the effective
      telemetry window at the current one-second simulator cadence.
      Done when: deterministic tests prove time- and count-based eviction and
      newest/oldest ordering at every boundary.

- [ ] Extend the BFF with history APIs and revision-linked SSE.
      Add the telemetry history endpoint for a selected device and retain the
      existing diagnostics endpoint as the technical inspection surface. Send a
      recent-event baseline in `room.snapshot`, then validated contiguous SSE
      updates for significant events and new telemetry readings.
      Done when: BFF and client tests prove reconnect baselines, cursor handling,
      malformed-message rejection and preservation of the last valid view.

#### Dashboard and simulator scenarios

- [ ] Add a permanently visible Dashboard feed of significant facts.
      Render availability and health changes, command lifecycle facts and LED
      state reports with device, time and command context. Exclude individual
      telemetry readings from this feed.
      Done when: a user can explain availability, health and a command outcome
      without interpreting raw payloads or opening logs.

- [ ] Add telemetry details to temperature device cards.
      Add a telemetry trigger that opens a device-specific view with a trend
      chart and accessible value/time/unit table. Fetch its baseline over HTTP
      and append new readings from SSE up to the 10,000-record limit.
      Done when: a new simulator reading appears in both chart and table without
      manual refresh, while stale/offline labels remain honest.

- [ ] Complete API-based diagnostics and development scenarios.
      Persist bounded quarantine metadata behind `GET /diagnostics`; add
      development-only malformed and future-dated input scenarios alongside
      duplicate and invalid input. Every resulting observation must still use
      the normal adapter, processor and persistence path.
      Done when: duplicate, malformed and future-dated inputs are explainable by
      diagnostics API and logs but cannot affect projection, history or feed.

#### Verification and acceptance

- [ ] Extend backend, contract and frontend tests for Stage 4 behavior.
      Cover migrations, transactions, failure closure, retention, restart/timeout
      recovery, HTTP cursors, SSE revisions, feed rendering and telemetry
      details. Add mocked-BFF Playwright coverage without starting the real
      backend or simulator.
      Done when: browser tests use schema-valid fixtures and deterministic
      synchronization, with no state injection or arbitrary waits.

- [ ] Write and execute the Stage 4 local acceptance checklist and walkthrough.
      Cover normal telemetry, stale/offline/recovery, degraded/recovered health,
      confirmation/rejection/timeout/late report, history persistence after
      restart and API/log diagnostics for ignored inputs.
      Done when: a reviewer can run the simulator route without hardware, follow
      the walkthrough and find a dated record with the verification commands.

### Stage 6 - Physical LED Actuation

- [ ] Implement physical LED actuation according to the external-actuation ADR
      before Stage 6 hardware acceptance. A physical state report must update
      observed state even during a Dashboard command; a matching report confirms
      the requested outcome without asserting causal attribution, while a
      non-matching report leaves the command pending.
      Done when: simulator or hardware-adapter tests and UI tests cover physical
      actuation with no active command, matching and non-matching active
      commands, and a matching report after timeout.
