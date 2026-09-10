# Implementation Follow-ups

This list records deliberately deferred implementation work. It does not define
binding system behavior; promote a durable rule to architecture documentation or
an ADR as part of the related change.

## Task Sizing Rule

Each unchecked item should normally produce one independently reviewable change:
one primary responsibility, a narrow public boundary and focused verification.
Do not combine a contract change, persistence/runtime change, BFF endpoint and
Dashboard feature in one item. A later integration item may compose already
completed pieces, but must not silently expand their behavior.

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

- [x] Persist accepted facts atomically before publishing their effects.
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

- [x] Add a durable command dispatch outbox and volatile command fallback.
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

- [x] Make the simulator command receiver idempotent for durable outbox retry.
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

- [x] Implement platform storage status and automatic recovery.
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

- [x] Restore the persisted room projection and bounded caches at startup.
      Rehydrate the latest projection, active commands, newest 20
      `recentCommands` and the bounded `recentEvents` projection cache before
      the first snapshot. Restore volatile feed entries without turning them
      into HTTP history; retain volatile device-evidence and command-durability
      markers until later durable evidence replaces them.
      Done when: a restart exposes the saved projection and bounded explanations
      with their original durability markers.

- [x] Define one deterministic ordering and maintenance path for recent caches.
      Order recent commands by descending discriminated terminal time and then
      descending `commandId`, identically during live insertion, checkpoint and
      restore. Keep the command and event caches independent of 30-day history
      retirement: each eligible candidate recomputes the greatest 20 while old
      retained cache entries preserve their visible timestamps. Do not emit an
      SSE removal merely because history retires a row.
      Done when: unit tests prove identical cache contents after live insertion,
      checkpoint/restore and history retirement.

- [x] Re-evaluate device freshness during startup recovery.
      Before the first snapshot, evaluate every configured freshness policy
      against the injected startup clock and restored `lastObservedAt`. Persist
      a resulting stale projection without history, feed, deduplication or
      watermark changes, preserving its evidence durability.
      Done when: a restart exposes time-correct fresh/stale state and the
      freshness-only write has no historical side effect.

- [x] Restore durable command deadlines without redispatching work.
      Reschedule each active durable command for its remaining timeout, or emit
      its terminal timeout immediately when the persisted deadline has passed.
      Do not redispatch a restored command as part of this change.
      Done when: deterministic timer tests cover both remaining and elapsed
      deadlines and confirm that startup causes no extra handoff.

- [x] Close restored volatile commands safely on restart.
      Convert each checkpointed active volatile command to a persisted failed
      lifecycle with `volatile_command_lost_on_restart` before the first
      snapshot. Do not restore its source plan or redispatch it.
      Done when: restart tests prove a volatile command is visible as failed and
      cannot produce a later restored confirmation.

- [x] Add runtime-session markers and conservative crash-gap recovery.
      Record session start and advance `lastDurableCommitAt` for every full
      checkpoint transaction, including freshness-only and command/outbox
      writes but not quarantine-only writes. Detect an unclosed earlier session
      and record a gap from the later of `sessionStartedAt` and
      `lastDurableCommitAt` before the first snapshot. Close the marker only
      after intake stops and the serialized coordinator drains.
      Done when: clean and interrupted shutdown tests prove the correct session
      marker and conservative gap boundary.

- [x] Provide an explicit corrupt-storage replacement startup action.
      Choose and document one one-shot CLI or configuration mechanism in storage
      composition. It must preserve the invalid file, create a new history
      generation, emit `storage_history_replaced`, start without inherited
      outbox or simulator receipts and never redispatch inaccessible work.
      Missing storage without this explicit action remains first-ever
      initialization and must not fabricate a prior gap.
      Done when: composition tests distinguish first initialization from
      operator-authorized replacement.

#### Observability and contracts

- [x] Configure JSON backend logging with an explicit `LOG_LEVEL`.
      Configure Fastify/Pino to write structured JSON to stdout; logs remain an
      operational surface, not domain history or a database table.
      Done when: the configured level controls startup and migration output.

- [x] Add safe correlation fields to backend logs.
      Include applicable `eventId`, `commandId`, `deviceId`, `source` and
      `reason` fields in rejected input, command-handling and storage-failure
      logs.
      Done when: focused log tests prove affected facts can be correlated.

- [ ] Redact credentials from structured backend logs.
      Redact authentication and cookie fields in the Pino/Fastify configuration
      and test representative request/error payloads.
      Done when: logged output never exposes the configured secret fields.

- [ ] Define shared durability, storage-status and record-identity contracts.
      Add TypeBox schemas for record and command durability, evidence durability
      for availability/health/observations, platform storage status,
      `platform.updated`, multi-record `recentEvents` deltas and stable
      `recordId`. Keep `historyGenerationId` and `storedThroughSequence` inside
      `platform.storage`, separate SSE revisions from durable cursors, and key
      physical rows by generation/sequence rather than unique `recordId`.
      Define logical identity so retry and volatile-to-durable redelivery reuse
      an ID while multi-record input remains distinct; permit reuse after the
      former physical row is retired.
      Done when: shared schemas express the complete identity/durability model.

- [ ] Define storage-watermark nullability and update semantics.
      Specify `storedThroughSequence: 0` for an empty store and keep storage
      `changedAt` stable across watermark-only changes. Permit
      `historyGenerationId: null` and `storedThroughSequence: null` only as a
      pair before the first valid database commit, including degraded/recovering
      startup; a later degradation retains the last known pair.
      Done when: contract tests reject invalid watermark combinations.

- [ ] Define shared command-admission and delivery-evidence contracts.
      Model pre-admission errors without command durability, admitted known-
      device rejections with both durability axes, and retryable 503
      `platform_recovering` with no lifecycle fact. Define HTTP durability as
      the synchronous admission result and SSE as lifecycle durability. Replace
      mandatory pending/terminal `dispatchedAt`: `handed_off` contains
      `dispatchedAt` and `deadlineAt`; `uncertain` contains `firstAttemptedAt`
      and `deadlineAt`, including in `recentCommands`.
      Done when: contract tests distinguish all admission and delivery variants.

- [ ] Define recent-event, diagnostics and cursor-page contracts.
      Add bounded newest-first recent-event feed, durable diagnostics and
      cursor-based raw-telemetry page schemas with generation,
      through-sequence, retention time and original raw-sample identity.
      Done when: schemas reject over-limit, unordered, dangling and
      timestamp-inconsistent entries.

- [ ] Define trend-query and response contracts.
      Require a non-empty half-open `[from, to)` range and `pointLimit >= 2`.
      Specify equal-time half-open buckets with min/max raw samples, assigning
      internal-boundary samples to the later bucket; order the whole response by
      `(occurredAt, storageSequence)`, breaking equal minima toward the earliest
      and equal maxima toward the latest sample.
      Done when: contract tests cover bucket and ordering boundaries.

- [ ] Define typed, scoped cursor failures and binding.
      Model expired-cursor, history-generation-changed, cursor-query-mismatch
      and `invalid_cursor` responses. Bind a cursor to canonical dataset,
      device/metric filters, time range, ordering and page size; make it
      tamper-evident or equivalently server-backed without promising survival
      across backend restart. Preserve the separate 20-entry `recentCommands`
      contract.
      Done when: contract tests reject altered scope and invalid cursor state.

- [ ] Implement time-based retirement for accepted and quarantined records.
      Retire accepted data after 30 days by `occurredAt` and quarantine after
      30 days by `recordedAt`, marking eviction with injected-clock `retiredAt`.
      Run cleanup at startup, on each write and before a first-page query.
      Done when: deterministic tests cover exact time boundaries and an
      immediately retired late fact.

- [ ] Implement independent retention caps without telemetry aggregation.
      Retain the 10,000 greatest `(occurredAt, storageSequence)` telemetry rows
      per device, 5,000 greatest significant facts globally and 1,000 greatest
      quarantine rows by `(recordedAt, internalSequence)`. Do not aggregate or
      replace raw telemetry; preserve the stated ten-second-cadence capacity.
      Done when: deterministic count-boundary tests prove independent caps and
      ordering.

- [ ] Retain deduplication evidence until all derived records retire.
      Keep an accepted `eventId` until its final significant or telemetry record
      is retired, including multi-record input handling.
      Done when: tests prove deduplication at the final-record eviction
      boundary.

- [ ] Pin read retention state and purge retired payloads safely.
      Capture `historyGenerationId`, `throughSequence` and `retentionAsOf` in
      the first-page read transaction. Keep retired payloads for the fixed
      five-minute cursor lifetime before physical purge.
      Done when: a cursor session can read its pinned retired data until expiry
      and cannot read it after safe purge.

- [ ] Add BFF endpoints for significant-fact, telemetry and trend history.
      Expose cursor-paginated significant facts, selected-device raw telemetry
      and bounded trends; diagnostics remain a technical inspection API. Pin
      global `historyGenerationId` and `throughSequence` on the first page and
      preserve them on every following page.
      Done when: BFF tests validate each endpoint's schema-valid pinned
      response.

- [ ] Enforce generation and query-scope safety for history cursors.
      Reject a cursor from another generation before reading its sequence from
      the current database; reject changed query scope without reinterpreting
      its position.
      Done when: BFF tests prove cross-generation and scope-change rejection.

- [ ] Publish revision-linked history baselines and deltas over SSE.
      Include a recent-event baseline in `room.snapshot`; emit contiguous
      updates for feed-worthy significant facts, telemetry and platform status.
      Let `platform.updated` carry `storage.gap.recorded`, follow every accepted
      durable outcome with a watermark-only platform delta and support
      recovery-only full `commands.updated` reconciliation before the
      available/gap platform delta.
      Done when: SSE tests prove the documented baseline and delta sequence.

- [ ] Make multi-revision BFF results atomic to connected clients.
      Queue every multi-revision result as a non-interleaving batch after final
      state is installed. A connection opened concurrently must receive the
      final revision-0 snapshot, never a partial batch.
      Done when: concurrency tests cover batch emission and concurrent connect.

- [ ] Return durable-history unavailability explicitly.
      Return service unavailable for durable reads while storage is degraded.
      Done when: BFF tests distinguish degraded reads from ordinary empty
      results.

- [ ] Maintain a bounded client live overlay for open history sessions.
      Create the overlay before the first request, retain every SSE-delivered
      addition through all page requests and merge by `recordId` without
      replacement. A session completes through its pinned bound; non-feed facts
      above it require explicit refetch/new session. Do not add replay or
      `Last-Event-ID`.
      Done when: client tests prove no live addition is lost across pagination.

- [ ] Rebuild client history safely after reconnect, expiry or generation change.
      On reconnect/recovery refetch each open range. An expired cursor starts a
      new session without discarding its overlay before the new baseline merges;
      retired rows remain visible through the pinned bound for five minutes.
      On changed generation, invalidate old pages/cursor/overlay, keep the last
      view visibly unavailable and rebuild from replacement baseline. Retain the
      last known non-null generation through degraded `null`; a matching later
      generation is ordinary recovery.
      Done when: client tests cover reconnect, cursor expiry, generation
      replacement and last-valid-view preservation.

#### Dashboard and simulator scenarios

- [ ] Add expected reporting intervals to periodic-observation device definitions.
      Model the interval per applicable capability and configure the simulator
      desk and window temperature sensors initially at ten and twenty seconds.
      Done when: device definitions expose their own cadence without changing
      unrelated device roles.

- [ ] Derive freshness from the configured device interval.
      Make the room projector mark an observation stale only after
      `3 × expectedIntervalMs` without a newer accepted reading; leave
      availability independent.
      Done when: injected-clock projector tests prove distinct thresholds and
      no availability change from a delayed report.

- [ ] Preserve the ordinary path for manual simulator readings.
      Keep development-only `emit_next_reading` as an immediate observation sent
      through the normal runtime path.
      Done when: a deterministic scenario test proves it restores freshness.

- [ ] Render a permanently visible Dashboard feed from recent-event contracts.
      Render availability/health changes, command lifecycle facts and LED state
      reports that change `reportedState` or confirm an active command, with
      device, time and command context.
      Done when: the component renders each supported feed record intelligibly.

- [ ] Exclude non-feed-worthy records from the Dashboard feed.
      Do not render non-applying/no-change facts or individual telemetry
      readings in the significant-fact feed.
      Done when: UI tests prove excluded input cannot create a feed item.

- [ ] Add browser coverage for explainable significant-fact feed entries.
      Verify a user can identify availability, health and a command outcome
      without inspecting raw payloads or logs.
      Done when: mocked-BFF browser tests cover representative entries and
      exclusions.

- [ ] Show the current storage status prominently in the Dashboard.
      Keep an error or recovery banner visible while storage is `degraded` or
      `recovering`, while continuing to render fresh realtime state and
      explaining temporary durable-history unavailability.
      Done when: UI tests cover available, degraded and recovering states.

- [ ] Label volatile Dashboard evidence and command state.
      Mark volatile observations, feed records and commands so the UI never
      implies they survive restart.
      Done when: component tests cover all three volatile evidence surfaces.

- [ ] Apply storage-aware command-control behavior in the Dashboard.
      Keep eligible controls enabled with a volatility warning in `degraded`;
      disable command admission controls in `recovering`. Handle a racing
      `503 platform_recovering` without local command state or automatic
      resubmission of user intent.
      Done when: mocked-BFF browser tests cover degraded admission and racing
      recovering rejection.

- [ ] Add a device-specific telemetry-details entry point and accessible view.
      Add a trigger on temperature cards that opens a trend chart plus accessible
      value/time/unit table for the selected device.
      Done when: component tests cover opening the view and table semantics.

- [ ] Load bounded telemetry baselines into the details view.
      Fetch the requested baseline over HTTP and retain only a bounded rendering
      set in frontend memory; raw history remains cursor-paginated in SQLite.
      Done when: frontend tests prove paged history does not become an unbounded
      in-memory collection.

- [ ] Merge live telemetry into the displayed chart and table.
      Append new SSE readings up to the rendering bound; after realtime
      reconnect, refetch the needed history range before resuming live appends.
      Done when: browser tests show a new simulator reading in both visual
      representations without refresh and preserve honest stale/offline labels.

- [ ] Expose bounded persisted quarantine metadata through `GET /diagnostics`.
      Keep diagnostics a technical API surface rather than a Dashboard or
      frontend contract.
      Done when: API tests return schema-valid bounded diagnostics.

- [ ] Add malformed and future-dated simulator development scenarios.
      Extend the existing duplicate/invalid scenarios with development-only
      malformed and future-dated inputs. Every observation must use the normal
      adapter, processor and persistence path.
      Done when: scenario tests trace each input through the ordinary boundary.

- [ ] Verify ignored-input diagnostics remain non-applying.
      Prove duplicate, malformed and future-dated inputs are explainable through
      diagnostics API and structured logs without changing projection, accepted
      history or the Dashboard feed.
      Done when: focused integration tests cover each rejected/ignored class.

#### Verification and acceptance

- [ ] Audit Stage 4 verification against the completed backlog items.
      Confirm every completed item's stated focused test evidence exists at the
      lowest credible layer and record any missing coverage as a new, narrowly
      scoped follow-up rather than enlarging this task.
      Done when: the Stage 4 checklist links each implemented behavior to its
      focused automated evidence.

- [ ] Validate mocked-BFF fixtures used by Stage 4 browser tests.
      Ensure all added browser scenarios use shared schema-valid fixtures and
      deterministic synchronization, with no state injection, arbitrary waits,
      real backend or simulator startup.
      Done when: the browser fixture-validation test suite passes.

- [ ] Write the Stage 4 local acceptance checklist and walkthrough.
      Document runnable steps for normal telemetry, stale/offline/recovery,
      degraded/recovered health, confirmation/rejection/timeout/late report,
      restart persistence and API/log diagnostics. Include normal cadence and
      per-device freshness-threshold observations without availability change.
      Done when: the checklist contains commands, expected results and a place
      for a dated verification record.

- [ ] Execute and record the Stage 4 local acceptance walkthrough.
      Run the documented simulator-only route and record the date, commands and
      observed results without requiring hardware.
      Done when: a reviewer can reproduce the walkthrough from the dated record.

### Stage 6 - Physical LED Actuation

- [ ] Map physical LED reports through the external-actuation adapter boundary.
      Implement physical LED actuation according to the external-actuation ADR
      before Stage 6 hardware acceptance, without bypassing the normal event
      path.
      Done when: adapter tests cover valid physical reports and their contract
      translation.

- [ ] Project physical LED reports independently of active Dashboard commands.
      A physical report always updates observed state, including while a
      Dashboard command is pending. A matching report confirms requested outcome
      without asserting causal attribution; a non-matching report leaves the
      command pending.
      Done when: simulator or hardware-adapter tests cover no active command and
      matching/non-matching active commands.

- [ ] Verify Dashboard behavior for physical LED reports and late confirmation.
      Cover physical state changes and a matching report after timeout through
      user-visible behavior.
      Done when: UI tests prove observed state and command lifecycle remain
      honest in these cases.
