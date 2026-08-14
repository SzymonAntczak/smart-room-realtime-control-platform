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

- [x] Record the Stage 4 storage and observability ADR.
      Define direct `node:sqlite` (`DatabaseSync`) behind a replaceable backend
      storage port, with Node `>=24.15 <25` as the supported runtime. Record
      its synchronous release-candidate trade-off and the conditions for
      reassessing it. Distinguish significant facts, raw telemetry,
      quarantined inputs, persisted current projections and JSON operational
      logs. Update the affected architecture documents, realtime ADR and
      roadmap so diagnostics are a technical API/log surface, not a Dashboard
      requirement.
      Done when: retention, ordering, storage-failure behavior, restart recovery
      and transport responsibilities are unambiguous; the decision also defines
      the durable-deduplication horizon, SQLite connection settings,
      prepare/commit boundary, durable outbox, volatile operation, recovery gap
      and HTTP/SSE watermark merge. Promote the aligned amendments to every
      affected ADR together with this accepted decision.

- [x] Add a replaceable backend storage port and SQLite migrations.
      Use local `node:sqlite`, a gitignored database file, WAL mode and
      schema-versioned deterministic migrations. Store significant facts, raw
      telemetry, quarantine, simulator command receipts and the latest room
      projection; add indexes for
      device/metric/time history reads. Generate and persist an opaque
      `historyGenerationId` when a new database is initialized; sequences are
      monotonic only inside that generation. Use prepared, parameterized
      statements and short transactions; do not add an ORM or query builder.
      Done when: an empty or prior database migrates safely and tests can create
      isolated temporary databases; migration, schema and platform-invariant
      failures cannot be misclassified as recoverable availability outages.

- [ ] Persist accepted facts atomically before publishing their effects.
      In one transaction persist either a significant fact or a telemetry
      sample, enforce the applicable retention and durable deduplication, and
      persist the derived room projection. A telemetry event remains an
      accepted platform fact but is not duplicated into significant history.
      Split processor preparation from runtime commit. On SQLite failure, roll
      back, change platform storage status to `degraded`, then apply the same
      prepared result in memory and publish it as volatile only when rollback is
      confirmed. Treat an indeterminate commit/rollback outcome as fatal: log
      `storage_commit_outcome_unknown`, publish and dispatch nothing, then let
      restart recovery make the database result authoritative.
      Capture injected-clock `receivedAt` and a private monotonic
      `ingestSequence` before queueing; use them for future-skew/quarantine time
      and FIFO without exposing them as storage cursors or SSE revisions.
      Model time-derived freshness as `derived_projection`: persist the
      projection before `device.updated`, but create no history, feed,
      deduplication or watermark. Keep command timeout as a significant
      lifecycle fact.
      Treat exact value/timestamp durable redelivery as a durability-only update
      for matching volatile device evidence and any cached item with the same
      logical `recordId`, without appending a feed item; older or conflicting
      evidence cannot upgrade it.
      Store canonical input fingerprints and dedup durability. Checkpoint
      bounded volatile guards without treating them as accepted history;
      identical replay after recovery performs one atomic durable
      reconciliation, while a different fingerprint for the same `eventId` is
      quarantined as `event_identity_conflict`.
      Fingerprint normalized validated semantic fields and exclude ignored
      envelope extras; equivalent timestamp encodings must compare equal.
      Done when: tests prove rollback, commit-before-publish in the durable path,
      volatile continuation only after confirmed rollback, fatal indeterminate
      commit handling, exactly-one outcome classification, exclusion of
      quarantined inputs, durability-only redelivery and preservation of
      late-report semantics.

- [ ] Add a durable command dispatch outbox and volatile command fallback.
      In available operation, atomically persist `command.requested`, its
      projection and an outbox intent before adapter dispatch. Use a stable
      `commandId`; distinguish definite handoff, definite no-handoff and
      uncertain handoff. Persist `command.dispatched` and outbox delivery after
      definite handoff, which must include `handedOffAt`, while retaining the
      applicable fixed timeout origin.
      Return 202 after durable or volatile admission, not handoff. Run the first
      dispatch as the next immediate serialized task and make frontend/BFF tests
      tolerate its SSE lifecycle before or after HTTP settlement by `commandId`.
      A definite no-handoff always fails without retry. An uncertain handoff
      becomes pending, records delivery uncertainty and starts a fixed deadline
      from its first attempt; single-flight retry runs every 500 ms, never moves
      that deadline and stops on any terminal lifecycle. Buffer synchronous
      reports across that boundary. Use captured backend `receivedAt`, not
      device time or dequeue time, for the strict `receivedAt < deadlineAt`
      confirmation gate. In
      degraded operation, mark new commands volatile, dispatch without an outbox
      and never retry them automatically.
      Pause all durable-outbox dispatch in `degraded` and `recovering` while
      confirmation and deadline processing continue in memory. Resume only
      active, unexpired work after recovery; close terminal/expired intents
      without dispatch.
      Done when: failure at every boundary is deterministic, durable retry is
      idempotent, responses expose intent and lifecycle durability, terminal
      volatile lifecycle closes pending outbox without redispatch, synchronous
      reports cannot race handoff persistence, and one device never has
      overlapping durable/volatile work. Do not enable automatic retry in the
      composed runtime until the simulator source-idempotency task below passes.
      Treat a confirmed rollback of initial request/outbox persistence as a
      transition to degraded followed by one volatile admission with the same
      `commandId`; fatal or indeterminate outcomes dispatch nothing. Split
      malformed, unknown-device and `platform_recovering` pre-admission errors
      from known-device policy/concurrency rejection, which creates a terminal
      durable or volatile command fact.

- [ ] Make the simulator command receiver idempotent for durable outbox retry.
      Treat repeated `set.power` with one `commandId` as one logical native
      command for at least the outbox retention horizon, including simulator
      restart. Before consuming the selected scenario or scheduling a result,
      durably store a source receipt with the command ID, canonical payload
      fingerprint, scenario, original due times and stable native outcome
      identities. Same-ID, same-payload retry returns or resumes the stored plan
      without creating another scenario; same ID with different payload fails
      deterministically. Document
      the same capability as a prerequisite for every later hardware/source
      adapter that enables retry. Non-terminal receipts are not age-evicted;
      terminal receipts remain for 30 days.
      Put the receipt boundary behind a simulator-owned port. Its in-process
      Stage 4 implementation uses a logically separate table through the shared
      SQLite connection owner without importing backend storage internals into
      the simulator package. Receipt failure before acceptance is definite
      no-handoff, while inability to inspect possible prior acceptance remains
      uncertain; an indeterminate current receipt commit is fatal. Produce a
      correlated source log and apply the shared SQLite failure taxonomy. Apply durable receipts only to outbox
      deliveries. Volatile commands use process-local idempotency, never restore
      their simulator plan and receive no automatic retry. Require future
      out-of-process sources to persist equivalent receipts on their side of the
      transport.
      Store the complete deterministic native outcome identity/payload in the
      initial receipt. If its due terminal-marker write rolls back, publish
      degraded first, emit that same plan once as volatile and reconcile the
      marker later without redispatch. After crash, re-emission must reuse the
      same identity; an indeterminate marker commit remains fatal.
      Done when: same-process, backend-restart and simulator-restart retry tests
      cannot create a second logical scenario, lifecycle or non-deduplicable
      native outcome; receipt-port tests distinguish known non-acceptance from
      unreadable prior acceptance and indeterminate current commit, prove shared
      storage-failure ordering and prove a volatile command does not require
      durable receipt persistence.

- [ ] Implement platform storage status and automatic recovery.
      Add `available`, `degraded` and `recovering` to the room projection and
      publish revision-linked `platform.updated` changes. Allow degraded startup,
      live observations, freshness and volatile commands. Classify failures as
      automatically recoverable availability, manual-intervention corruption,
      or fatal schema/invariant failures. Probe recoverable failures every five
      seconds with schema validation and a rollback-only write transaction.
      If unavailable-path startup happened before first initialization, run the
      full schema and rollback-only write probe in an exclusive temporary
      SQLite file in the same directory. Do not create the target database
      there. Let cutover atomically create its schema, history generation,
      runtime session marker, checkpoint and gap. Migration failure remains
      fatal. Treat only a zero-length/valid SQLite file with no application
      metadata or user tables as a pristine first-initialization candidate; this safely covers a
      pre-commit crash. A partial, foreign or otherwise invalid schema is never
      treated as empty. Revalidate any target that appears between probe and
      cutover rather than overwriting it.
      During recovery block new commands, continue volatile ingest, then use a
      serialized cutover to queue later input while atomically persisting the
      checkpoint and `storage.gap.recorded`. Do not backfill outage data.
      Finish the currently dequeued volatile input before establishing the
      boundary, then queue later raw observation/timer inputs unprepared. After
      commit, prepare them FIFO against the recovered projection; after abort,
      prepare them FIFO against the volatile projection.
      After commit, atomically install the final projection. If connected
      clients lack restored device, command or non-gap feed-cache state, publish
      one full `commands.updated` reconciliation revision with the complete
      bounded non-gap cache for client-side `recordId` deduplication, then
      `platform.updated(available)` with watermark and gap. New connections must
      read only the final projection snapshot.
      Default the cutover queue to 1,000 inputs; overflow aborts recovery and
      drains queued work as volatile without dropping the new input. Reclassify
      every recovery-time storage error through the same failure taxonomy.
      After confirmed nonfatal rollback drain the raw FIFO as volatile;
      indeterminate/fatal outcomes terminate without draining or publishing.
      Done when: tests cover every failure class, degraded startup, write probes,
      cutover assignment, bounded queued input, recovery conflicts, gap delivery
      and return to available.

- [ ] Restore runtime state and command timers from SQLite at startup.
      Rehydrate the latest projection, active commands and newest 20
      `recentCommands` plus the bounded `recentEvents` projection cache.
      Before exposing the first snapshot, reevaluate every configured freshness
      policy against the injected startup clock and restored `lastObservedAt`;
      persist any resulting projection-only stale state without history, feed,
      deduplication or watermark and preserve its evidence durability.
      Order recent commands by descending discriminated terminal time, then
      descending `commandId`, identically during live insertion, checkpoint and
      restore.
      Keep both recent caches independent of 30-day history retirement: old
      entries retain visible timestamps, and each new eligible candidate
      recomputes the greatest 20 by the cache's deterministic order. Never emit
      an SSE removal for history retirement.
      Reschedule a durable command's remaining timeout, or emit a terminal
      timeout immediately when its deadline passed. Never redispatch a
      checkpointed active volatile command; persist it as failed with
      `volatile_command_lost_on_restart` before exposing the first snapshot.
      Restore volatile feed cache entries without converting them into HTTP
      history, and preserve volatile device-evidence and command durability
      markers until a later durable fact replaces them. Detect an unclosed prior runtime session and record a conservative
      gap from the later of its persisted `sessionStartedAt` and
      `lastDurableCommitAt` before the first snapshot. Close a clean-shutdown
      marker only after intake stops and the serialized coordinator drains;
      leave it active when shutdown cannot complete that boundary.
      Advance `lastDurableCommitAt` on every transaction that persists the full
      checkpoint, including freshness-only and command/outbox writes, but not a
      quarantine-only transaction.
      Treat replacement of a corrupt database as an explicit operator startup
      action, preserve the invalid file, create a new history generation and
      emit `storage_history_replaced` without fabricating a prior gap. Choose a
      concrete one-shot CLI or configuration mechanism in the storage
      composition task; missing storage without replacement intent is only
      first-ever initialization. Start the replacement generation with no
      inherited outbox or simulator receipts and never redispatch inaccessible
      prior work.
      Done when: restart retains bounded command/feed explanations, exposes
      time-correct freshness and never redispatches volatile work or reconfirms
      an already terminal command.

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
      cursor-based raw telemetry pages, bounded trend-history responses and
      durable diagnostics. Add record and command durability, platform storage
      status with `historyGenerationId` and `storedThroughSequence` only inside
      `platform.storage`, history `historyGenerationId`, `throughSequence`,
      `retentionAsOf`, `platform.updated`, multi-record
      `recentEvents` deltas and stable `recordId`. Define record identity by
      logical source/event/record kind, command/lifecycle kind or persisted
      platform-generated ID so retry and volatile-to-durable redelivery reuse
      one ID while multi-record input stays distinct. Command contracts expose
      `durability` and `lifecycleDurability`; availability, health and each
      observation expose evidence durability. Keep SSE revisions separate from
      durable history cursors.
      Key physical records by generation/sequence rather than unique
      `recordId`; allow a post-dedup replay to reuse the logical ID only when its
      former row is retired, while cursor positions remain sequence-based.
      Define pre-admission error unions without command durability and admitted
      known-device rejection unions with both axes; `platform_recovering` is a
      retryable 503 and creates no command lifecycle. Define HTTP durability as
      the synchronous admission outcome only; later SSE projections own current
      lifecycle durability.
      Replace mandatory pending/terminal `dispatchedAt` with delivery evidence:
      `handed_off` carries `dispatchedAt` and `deadlineAt`, while `uncertain`
      carries `firstAttemptedAt` and `deadlineAt`. Preserve that evidence in
      `recentCommands`.
      Define `storedThroughSequence: 0` for an empty store and keep storage
      `changedAt` stable across watermark-only updates.
      Trend queries require a non-empty half-open `[from, to)` range and
      `pointLimit >= 2`; use equal-time half-open buckets with min/max raw
      samples, assigning an internal-boundary sample to the later bucket, then
      order the complete response
      ascending by `(occurredAt, storageSequence)` without replacing stored raw
      samples. Break equal minima toward the earliest sample and equal maxima
      toward the latest so flat buckets retain their endpoints.
      Capture generation, through-sequence and retention time in one read
      transaction and return original raw-sample identity on each point so live
      SSE telemetry can deduplicate against the bounded baseline.
      Define typed expired-cursor, history-generation-changed and
      cursor-query-mismatch responses. Bind each cursor to a canonical dataset,
      device/metric filters, time range, ordering and page size from its first
      page. Define a typed `invalid_cursor`; make cursors tamper-evident or back
      them with equivalent server state, without promising survival across
      backend restart. Preserve the separate 20-entry `recentCommands` contract. Allow
      `historyGenerationId: null` and `storedThroughSequence: null` only
      together before the first valid database commits, including its degraded
      and recovering states; a runtime degradation retains the last known pair.
      Done when: contract tests reject malformed, unordered, over-limit,
      timestamp-inconsistent and dangling entries.

- [ ] Apply Stage 4 retention rules in storage reads and writes.
      Expose accepted data for at most 30 days by `occurredAt` and quarantine by
      `recordedAt`. Enforce independent hard caps: retain the 10,000 greatest
      `(occurredAt, storageSequence)` telemetry rows per device, the 5,000
      greatest significant facts globally and the 1,000 greatest quarantine
      rows by `(recordedAt, internalSequence)`. Mark eviction with an injected-
      clock `retiredAt`; clean at startup, in each write and before a first-page
      query. Pin `historyGenerationId`, `throughSequence` and `retentionAsOf`.
      Preserve retired
      payloads for the fixed five-minute cursor lifetime before physical purge.
      Do not aggregate or
      replace raw telemetry; at the normal ten-second simulator cadence, 10,000
      samples retain about 27.8 hours per device. Keep an accepted `eventId`
      until its last derived significant or telemetry record is evicted.
      Done when: deterministic tests cover time/count eviction, an immediately
      evicted late fact, multi-record input deduplication and ordering at every
      boundary.

- [ ] Extend the BFF with history APIs and revision-linked SSE.
      Add cursor-paginated significant-fact history, selected-device telemetry
      history and bounded trend endpoints; retain diagnostics as the technical
      inspection surface. The first history page pins a global
      `historyGenerationId` and `throughSequence`, and every cursor page
      preserves both. Reject a cursor from another generation without reading
      its sequence against the current database, and reject changed query scope
      without reinterpreting its position. Send a recent-event
      baseline in `room.snapshot`, then contiguous SSE updates for feed-worthy
      significant facts, telemetry and platform status. Allow `platform.updated`
      to carry `storage.gap.recorded` and use a following watermark-only platform
      delta after each accepted durable outcome. Support the recovery-only full
      `commands.updated` reconciliation before the available/gap platform delta.
      Queue each multi-revision result as a non-interleaving batch after
      installing final state; a concurrent connection receives the final
      revision-0 snapshot and no partial batch.
      Return service unavailable for durable reads while degraded. On reconnect or recovery, refetch each open
      HTTP range. Create a bounded live overlay before the first request, retain
      every SSE-delivered addition across all page requests and merge by
      `recordId` without replacing the overlay. Treat a pagination session as
      complete through its pinned bound; significant facts excluded
      from the feed and committed above that bound appear only after an explicit
      refetch or new session. Keep retired rows visible to that bound for a fixed
      five-minute cursor lifetime; expired cursors start a new session without
      discarding the overlay before the new baseline merges. Do not add replay
      or `Last-Event-ID`.
      When a reconnect snapshot exposes a changed generation, invalidate old
      pages, cursor and overlay, keep the last view only as visibly unavailable,
      then rebuild from the replacement baseline. Retain the last known non-null
      generation through degraded `null` and apply the same comparison to a
      later `platform.updated`; a matching generation is ordinary recovery.
      Done when: BFF and client tests prove reconnect baselines, cursor handling,
      pinned snapshot isolation, 503 recovery, malformed-message rejection and
      preservation of the last valid view.

#### Dashboard and simulator scenarios

- [ ] Make freshness policy device- and capability-specific.
      Each periodic-observation device definition declares its expected
      reporting interval; the room projector centrally derives freshness as
      `stale` only after `3 × expectedIntervalMs` without a newer accepted
      observation. Keep availability independent. Configure the two simulator
      temperature sensors for their own normal cadences, starting with ten
      seconds for the desk sensor and twenty seconds for the window sensor.
      Keep the development-only `emit_next_reading` scenario as an immediate
      observation through the ordinary runtime path.
      Done when: deterministic tests prove that different device intervals use
      different stale thresholds, a delayed report does not alter availability,
      and a manually emitted reading restores freshness.

- [ ] Add a permanently visible Dashboard feed of significant facts.
      Render availability and health changes, command lifecycle facts and LED
      state reports that change `reportedState` or confirm an active command,
      with device, time and command context. Exclude non-applying/no-change
      facts and individual telemetry readings from this feed.
      Done when: a user can explain availability, health and a command outcome
      without interpreting raw payloads or opening logs.

- [ ] Show platform storage durability in the Dashboard.
      Keep an error or recovery banner visible while storage is `degraded` or
      `recovering`. Mark volatile observations, feed records and commands so the
      UI never implies they survive restart. Continue rendering fresh realtime
      state while durable history views explain their temporary unavailability.
      Keep eligible controls enabled with a volatility warning in `degraded`,
      disable command admission controls in `recovering`, and handle a racing
      `503 platform_recovering` without creating local command state or
      automatically resubmitting user intent.
      Done when: storage failure and recovery are understandable without logs,
      and realtime read/control remains usable with honest durability labels.

- [ ] Add telemetry details to temperature device cards.
      Add a telemetry trigger that opens a device-specific view with a trend
      chart and accessible value/time/unit table. Fetch its baseline over HTTP
      and append new readings from SSE only up to a bounded rendering limit;
      raw history remains cursor-paginated in SQLite rather than held in
      frontend memory. On realtime reconnect, re-fetch the needed history range
      before continuing live appends.
      Done when: a new simulator reading appears in both chart and table without
      manual refresh, while stale/offline labels remain honest.

- [ ] Complete API-based diagnostics and development scenarios.
      Persist bounded quarantine metadata behind `GET /diagnostics`; add
      development-only malformed and future-dated input scenarios alongside
      duplicate and invalid input. Every resulting observation must still use
      the normal adapter, processor and persistence path. Diagnostics are
      verified via the technical API and structured logs, not a new Dashboard
      or frontend contract; the existing dev-panel diagnostic affordance may
      remain a development convenience.
      Done when: duplicate, malformed and future-dated inputs are explainable by
      diagnostics API and logs but cannot affect projection, history or feed.

#### Verification and acceptance

- [ ] Extend backend, contract and frontend tests for Stage 4 behavior.
      Cover migrations, transactions, degraded continuation, retention,
      restart/timeout recovery, durable deduplication, outbox retry, volatile
      command non-retry, source idempotency, SQLite error classification,
      recovery cutover, checkpoint/gap, two-axis command and per-evidence
      durability, pinned HTTP generation/cursor/watermark merging, bounded trend responses,
      SSE revisions, feed-bearing `platform.updated`, feed rendering and
      telemetry details. Cover uncertain-handoff pending/timeout behavior,
      terminal definite no-handoff and explicit refetch of concurrent non-feed
      facts. Cover terminal projections that remain uncertain without a fake
      `dispatchedAt`, watermark-only platform deltas and retention between
      cursor pages. Inject receipt-operation failure at its source-owned port
      while proving that the co-located SQLite error follows shared platform
      storage status and ordering; also cover the receipt-free volatile command
      path and rejection of cursors
      after history-generation replacement. Cover per-device
      cadence and `3 × expectedIntervalMs` freshness with injected clocks and
      timers. Add mocked-BFF Playwright coverage without starting the real
      backend or simulator.
      Done when: browser tests use schema-valid fixtures and deterministic
      synchronization, with no state injection or arbitrary waits.

- [ ] Write and execute the Stage 4 local acceptance checklist and walkthrough.
      Cover normal telemetry, stale/offline/recovery, degraded/recovered health,
      confirmation/rejection/timeout/late report, history persistence after
      restart and API/log diagnostics for ignored inputs. Demonstrate normal
      telemetry at each configured device cadence, then freshness changing after
      the corresponding per-device threshold without changing availability.
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
