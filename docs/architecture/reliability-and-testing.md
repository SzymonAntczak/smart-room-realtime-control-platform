# Reliability and Testing

## Core Reliability Rules

- The UI must distinguish requested state from confirmed state.
- Device availability must not be inferred from the age of telemetry or state reports.
- Offline devices must not be silently treated as available.
- Degraded health must be visible without being misrepresented as offline.
- Stale observation data must be visible when it is still shown.
- A future dedicated history slice should make important user actions traceable.
- Command failures and timeouts should be first-class states, not generic errors.
- Terminal command outcomes should remain available through bounded command
  history with their reason and timing metadata.
- The Stage 4 UI must keep storage `degraded` and `recovering` visible,
  and must never present volatile observations or commands as durable.
- A Stage 4 SQLite outage must not by itself stop fresh device projections,
  freshness evaluation or explicitly volatile commands.
- For a production-like MQTT source, broker loss makes its devices unavailable
  to the platform with the explicit reason `broker_unavailable`; it blocks
  commands but does not erase their last observed state.
- A broker reconnect alone is not evidence that a device is online. A retained
  availability message, heartbeat or other device-appropriate signal must
  restore availability.

## Failure Modes To Simulate

The completed temperature reference slice covers the following read-path
scenarios through automated tests and development controls where applicable:

- lost telemetry event
- duplicate telemetry event
- telemetry observation becomes stale while availability remains unchanged
- device becomes explicitly offline
- device recovers availability and later reports a fresh observation
- invalid telemetry payload
- realtime stream reconnect while retaining the last valid snapshot
- transient SSE backpressure during a command lifecycle waits for `drain` and
  preserves contiguous revision-linked updates without reconnecting
- sustained SSE backpressure beyond one waiting publication batch closes the
  stream so the client recovers with a fresh snapshot

The completed LED reference slice covers delayed confirmations, command rejection
and late confirmation after timeout. It also covers an availability change while
a command is pending and preserves that command until its normal terminal
outcome. Degraded health reports are part of the device-state model. Future-dated device
reports are rejected by the platform event contract and can be emitted through
the development controls to verify the normal simulator-to-diagnostics path.

MQTT-backed slices additionally cover broker unavailable and reconnect,
subscription recovery, malformed native payloads, duplicate delivery and
retained-message bootstrap. These scenarios run through the normal local
simulator runtime. Isolated domain and adapter tests may use direct test seams
without maintaining a second end-to-end route.

## Observability

The platform should make these questions easy to answer:

- What did the user request?
- When was the command dispatched?
- What did the device actually report?
- Did the command fail, time out or complete?
- Did any matching device report arrive after the command timed out?
- Was the device healthy when the command was sent?
- Is the device unavailable because of its own signal or because its required
  broker transport is unavailable?
- For Stage 4, was storage available, and is each relevant observation
  or command lifecycle durable or volatile?
- For Stage 4, does durable history contain an explicit gap for a
  storage outage?

## Recovery Behavior

When explicit availability evidence reports that a device reconnects:

1. the processor should mark the device as `online`
2. a later accepted observation should update `lastObservedAt` and freshness
3. the UI should replace stale values when a fresh observation arrives
4. unresolved commands should remain historically visible, even after recovery

Automatic Stage 4 storage recovery remains a follow-up. Its planned runtime
will probe SQLite every five seconds with a schema check and rollback-only write
transaction. It will enter `recovering`, temporarily block new commands and
keep processing observations as volatile. A serialized cutover will briefly
stop dequeuing, checkpoint every result through its boundary, write
`storage.gap.recorded`, then process later queued inputs as durable. It will not
backfill volatile telemetry or events. Active volatile commands will not be
redispatched; a conflict with restored durable work will keep recovery waiting
so one device never has overlapping active commands.

The proposed failure taxonomy distinguishes automatically recoverable storage
availability, corruption requiring manual intervention, and fatal migration,
schema or platform-invariant failures. Only the first category runs automatic
probes. The UI and correlated logs expose which category applies.

## Testing Strategy

The testing strategy should follow the risk in the system: state derivation, command lifecycle and realtime UI behavior matter more than superficial coverage.

### Contract Tests

Contract tests should verify that events and commands match the documented schemas.

Focus areas:

- required envelope fields
- unknown or malformed events
- idempotency for duplicate events
- Stage 4 durability discriminators, platform storage status and history
  generation/watermark/cursor separation

### State Model Tests

State model tests should cover how raw events become derived room state.

Focus areas:

- reported state updates
- requested state tracking
- command confirmation
- command failure and timeout
- late confirmation after timeout
- independent availability and freshness transitions
- health degradation and recovery transitions
- bootstrap `unknown`, reason retention and per-capability freshness
- delayed or equal-timestamp availability and health transitions cannot regress state
- availability loss during an active command leaves it pending until explicit failure or timeout

Stage 4 focus areas:

- prepare does not mutate state before runtime commit
- time-derived freshness is a projection-only outcome: it commits before
  `device.updated` but creates no history, feed, deduplication or watermark
- command timeout remains a significant lifecycle fact rather than a
  projection-only timer update
- a durable write failure applies the prepared result as volatile and emits a
  storage-status transition only after rollback is confirmed
- an indeterminate commit is fatal, publishes and dispatches nothing, and lets
  restart recovery determine whether the transaction exists
- recovery checkpoint and storage gap preserve newer observations without
  backfilling outage history
- recovery publishes a full command/device reconciliation delta when restored
  projection or non-gap feed-cache state differs, before the available/gap
  platform delta; a new connection sees only the final snapshot
- outcome/watermark, degraded/volatile and recovery/platform revision pairs are
  non-interleaving batches; connections opened mid-batch receive final snapshots
- durable outbox retry and volatile command non-retry never overlap commands for
  one device
- durable outbox dispatch pauses during degraded/recovering while confirmation
  and timeout continue; recovery does not retry terminal or expired work
- source-owned command idempotency prevents one outbox retry from scheduling a
  second logical simulator scenario
- durable simulator receipts preserve source-owned idempotency across simulator
  restart, resume one persisted plan with its original due times and reject reuse
  of one `commandId` with different intent
- a confirmed rollback while marking a due source result terminal degrades
  storage before emitting its pre-persisted stable identity as volatile;
  recovery closes it and crash can only re-emit that identity
- the simulator-owned receipt port uses a separate table in the shared Stage 4
  database; a known failure before acceptance produces definite no-handoff, an
  unreadable possible prior acceptance remains uncertain, an indeterminate
  current commit is fatal, the SQLite error follows platform storage ordering,
  and volatile commands require no durable receipt or retry
- an uncertain handoff becomes pending, uses the first attempt as its fixed
  timeout origin and retries single-flight every 500 ms until confirmation,
  failure or timeout
- uncertain pending and terminal projections retain first-attempt delivery
  evidence without fabricating `dispatchedAt`
- a definite no-handoff always creates a terminal failure without retry
- known-device policy/concurrency rejection is an admitted durable or volatile
  terminal fact, while malformed, unknown-device and recovering errors remain
  pre-admission and create no lifecycle
- confirmed rollback of initial command/outbox persistence publishes degraded
  before one volatile dispatch; indeterminate outcome dispatches nothing
- HTTP 202 follows admission without awaiting handoff; SSE lifecycle may arrive
  on either side of the response and still correlates by `commandId`
- the recovery cutover assigns every queued input to exactly one side of the
  volatile/durable boundary and never prepares a post-boundary input against the
  pre-recovery projection
- confirmed recovery rollback drains the raw FIFO as volatile after degraded;
  indeterminate recovery commit terminates without draining or publication
- recovery queue delay preserves ingress-time future-skew classification and
  FIFO through an internal sequence that is never exposed as history or SSE
- a matching report received before `deadlineAt` confirms despite queue delay,
  while one received at or after it times out first and only updates observed
  state
- restart turns a checkpointed active volatile command into
  `volatile_command_lost_on_restart` without dispatch
- restart restores the bounded recent-event cache without promoting its volatile
  entries into durable HTTP history
- restart reevaluates restored observation freshness against the injected clock
  before the first snapshot, so elapsed downtime can produce a projection-only
  stale state without history, feed or watermark
- checkpointing does not promote volatile device evidence, command intent or
  lifecycle markers; only later durable facts change their durability
- live and restored `recentCommands` use terminal-time/command-ID ordering and
  the same 20-entry bound
- history retirement does not prune count-bounded recent event/command caches or
  require removal deltas; new eligible candidates recompute their greatest 20
- exact durable redelivery may upgrade matching volatile device evidence only;
  older or conflicting facts preserve both state and durability without feed
  noise
- logical `recordId` is stable across retry and volatile-to-durable redelivery,
  while record-kind/source namespaces prevent collisions for multi-record input
- physical rows use generation/sequence; a post-dedup replay may reuse logical
  `recordId` only after the former row retired, preserving cursors and UI merge
- an unclosed runtime session records a conservative storage gap from the later
  of its start and last durable commit before exposing the first snapshot
- `lastDurableCommitAt` advances on every transaction that persists the complete
  checkpoint, including projection-only and command writes, but not
  quarantine-only storage
- clean shutdown closes intake and drains committed work before closing the
  session marker; interrupted shutdown leaves it active for restart recovery
- replacement of a corrupt database starts a new history generation and logs
  that loss without inventing an exact gap, backfill or redispatch from the old
  co-located outbox/receipt state
- degraded startup before first database creation probes the normal migration
  path in a temporary same-directory database, while cutover atomically creates
  the target generation, checkpoint and gap; migration failure remains fatal
  and a pre-commit pristine file is retryable without treating partial or
  foreign schema as empty
- a cursor from an earlier `historyGenerationId` is rejected after replacement,
  and the frontend never merges pages or overlay entries across generations
- a client retains its last known generation through degraded `null`, treats a
  matching recovery generation as a refetch and resets history when either a
  snapshot or `platform.updated` supplies a different generation
- SQLite error classification never loops recovery for corruption or hides a
  migration/programming defect as degraded availability
- time/count retention evicts by the documented ordering and keeps an accepted
  `eventId` until its last derived retained record is removed
- volatile dedup guards retain input fingerprints through checkpoint, allow one
  identical durable reconciliation and quarantine conflicting identity reuse
- retention during pagination preserves the pinned view through the fixed
  cursor lifetime and rejects an expired cursor deterministically
- cursor validation rejects changed dataset, device, metric, time range,
  ordering or page size instead of reinterpreting a pinned session
- malformed or forged cursor bounds/expiry/position are rejected, and backend-
  restart invalidation restarts the session without losing the bounded overlay

### Simulator Scenario Tests

Simulator scenarios should be repeatable and named after real failure modes.

Initial scenarios:

- `confirm_immediately`: matching LED state report immediately after the native command
- `confirm_delayed`: matching LED state report 2000 ms after the native command
- `reject_command`: explicit LED command rejection without a state report
- `omit_confirmation`: no LED state report, so the command times out after 5000 ms
- `report_after_timeout`: matching LED state report after 6000 ms; it updates
  observed state but does not reconfirm the timed-out command
- telemetry stops and its observation becomes stale while availability stays online
- explicit device disconnection changes availability to offline and suppresses
  periodic and development-triggered telemetry until reconnect
- explicit reconnection changes availability to online and resumes its schedule; a later report refreshes observation data
- device health becomes degraded while availability remains online
- degraded health recovers without rewriting availability or freshness
- future-dated report is ignored and a later time-valid report refreshes the observation

### MQTT Runtime And Transport Tests

After Stage 5, run the real local broker for every simulator runtime or
end-to-end test. Direct seams are limited to isolated domain and adapter tests.
In addition to normal command and observation flows, verify:

- the MQTT simulator, ESP32/ESPHome and standalone-device adapters translate their own
  native payloads to the shared platform contract;
- broker loss projects `broker_unavailable` and blocks commands for MQTT-only
  devices;
- backend reconnect waits for new device availability evidence before restoring
  `online`;
- retained state is handled as bootstrap evidence, not as event history;
- QoS or reconnect delivery duplicates do not corrupt projections.

### UI Behavior Tests

UI tests should verify user-visible system behavior.

Focus areas:

- accepted and pending command progress is visible
- confirmed state is not faked from requested state
- availability and stale observation data are visible as distinct states
- degraded health is visible separately from availability and freshness
- failed and timed-out commands remain understandable
- future history work has an explicit traceability acceptance criterion

Stage 4 UI focus areas:

- storage degradation is permanently visible while current volatile device and
  command updates continue
- degraded controls remain usable with a volatility warning; recovering
  controls are disabled and a racing 503 creates no phantom command
- HTTP history is complete through its pinned generation and watermark;
  buffered SSE additions merge by `recordId` without loss or revision/cursor
  confusion, while non-feed facts committed above the bound appear after an
  explicit refetch
- bounded trend responses expose the same generation/watermark snapshot and
  original raw-sample identities so concurrent SSE telemetry can be
  deduplicated; tests cover half-open range/bucket boundaries and reject a point
  limit below two
- durable history/telemetry outcomes advance the client watermark through a
  following contiguous `platform.updated` without duplicating their feed record
  or telemetry sample; projection-only freshness does not
- the bounded live overlay starts before HTTP, survives all pages and cursor
  restart, is never replaced by a later page response and evicts only according
  to the documented view bound
- a durable command intent with a volatile lifecycle and mixed durable/volatile
  device evidence remain distinguishable

The LED scenario timing and transport defaults are defined in
[ADR: LED Command Transport and Operational Defaults](../decisions/adr-led-command-transport-and-operational-defaults.md).

## Manual Acceptance Checklist

Before treating a milestone as done, verify:

- a user can see current room state
- a user can send a command
- the UI shows the command as pending before confirmation
- the UI updates after a device report
- command outcome and failure state remain visible
- at least one failure scenario is visible, not hidden
