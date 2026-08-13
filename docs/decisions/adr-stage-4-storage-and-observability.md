# ADR: Stage 4 Storage and Observability

## Status

Accepted

## Context

The completed simulator reference slices keep projections, deduplication state,
terminal command history and ignored-input diagnostics in process memory. This
is enough to demonstrate the control loop, but it cannot retain an explanation
of current state across a restart or provide bounded telemetry history.

Stage 4 needs durable local storage without adopting full event sourcing, an
ORM, a query builder or a new MQTT runtime. SQLite is an observability and
recovery dependency, not the source of current device truth. A storage outage
must be visible without unnecessarily stopping fresh observations or local
control.

The existing client recovery model must remain coherent: one SSE connection
provides a projection baseline and revision-linked live updates, while HTTP
provides pageable durable history. Quarantine diagnostics remain a technical
inspection surface, not a Dashboard feed.

## Options Considered

- Keep history, diagnostics and deduplication only in process memory.
- Stop the whole platform whenever durable storage is unavailable.
- Continue realtime processing but reject every command during an outage.
- Continue realtime processing and explicitly mark work created during an
  outage as volatile.
- Use an external database service, an ORM or full event sourcing.
- Use direct `node:sqlite` `DatabaseSync` behind a backend storage port.

## Decision

### Storage boundary and connection

Use direct `node:sqlite` `DatabaseSync` behind a replaceable backend storage
port. The Stage 4 runtime supports Node.js `>=24.15 <25`. The port owns domain
operations and transaction boundaries; platform code and BFF handlers do not
depend on SQLite tables, SQL or `DatabaseSync`.

The local runtime opens one database connection per backend process. It enables
foreign-key enforcement and SQLite defensive mode, disables extension loading,
sets `journal_mode=WAL`, `synchronous=FULL` and a zero busy timeout, and keeps
the default WAL auto-checkpoint behavior. It uses prepared parameterized
statements and short write transactions. The database file is local and
gitignored.

Every successfully initialized backend history database owns an opaque,
randomly generated `historyGenerationId` stored in its schema metadata. The ID
is stable for that database lifetime and changes only when a new database is
created. Database-global storage sequences are monotonic and never reused
within one history generation; they are not comparable across generations.

`DatabaseSync` is intentionally synchronous and release-candidate technology.
Reassess it before widening the supported Node range, if storage work makes
control-loop latency materially worse, if the runtime needs concurrent writers,
or if Node changes the API's stability or semantics. A replacement must
preserve the port's transaction, ordering and recovery guarantees.

### Processing outcomes and storage classification

The event processor exposes a non-mutating **prepare** boundary. Preparation
validates the input and returns exactly one result:

- `accepted_applied`: an accepted fact or telemetry sample, a candidate room
  projection and zero or more feed-worthy derived facts;
- `accepted_non_applying`: an accepted, auditable fact and diagnostics metadata
  without a projection or feed change;
- `derived_projection`: a time-derived projection transition, initially
  freshness only, without an accepted input record, deduplication identity,
  history or feed entry;
- `quarantined`: an invalid, duplicate, future-dated or otherwise rejected
  input, without an accepted-history or durable-deduplication record.

The runtime owns **commit**. When storage is available, it persists the prepared
result and only then swaps the in-memory projection and publishes SSE. When
storage is degraded, it commits accepted results to process memory with
`durability: volatile`. Classification happens from processor semantics, not by
comparing serialized SSE deltas.

A durable transaction has exactly three storage outcomes: committed, confirmed
rolled back, or indeterminate. Volatile fallback is allowed only after the port
has confirmed that no commit occurred and the transaction is closed. If a
write/commit error leaves the outcome indeterminate, the runtime logs a fatal
`storage_commit_outcome_unknown`, publishes no result, performs no command
dispatch and terminates. SQLite recovery on restart then determines whether the
transaction exists, and normal checkpoint/outbox restoration exposes that
authoritative result. This safety condition takes precedence over the original
SQLite error's availability class.

At ingress, before any recovery queue, the serialized coordinator assigns every
external observation or internal timer input an in-process monotonic
`ingestSequence` and injected-clock `receivedAt`. The sequence defines FIFO and
the recovery boundary but is never exposed as `storageSequence`, an HTTP cursor
or an SSE revision. Preparation uses the captured `receivedAt` for future-skew
validation and as quarantine `recordedAt`; queue delay therefore cannot turn a
future-dated report into an accepted one. Timer inputs retain their explicit
deadline or due time and evaluate lateness when dequeued.

| Prepared outcome                                                                     | Storage/history path                      | Recent-event feed |
| ------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------- |
| Accepted `telemetry.reading.recorded`                                                | Raw telemetry                             | Never             |
| Applying availability or health transition                                           | Significant fact                          | Always            |
| Command lifecycle fact, including derived terminal outcome                           | Significant fact                          | Always            |
| Accepted LED state report that changes `reportedState` or confirms an active command | Significant fact                          | Always            |
| Accepted LED state report that changes neither `reportedState` nor command lifecycle | Significant fact                          | Never             |
| Equal or older availability or health transition                                     | Significant fact and diagnostics metadata | Never             |
| Time-derived freshness transition                                                    | Projection checkpoint only                | Never             |
| Duplicate, malformed, future-dated or otherwise rejected input                       | Quarantine and diagnostics metadata       | Never             |

A report arriving after timeout never changes that terminal command. It belongs
in the feed only when it changes `reportedState`; being late is not by itself a
feed-worthy condition.

One accepted input may create more than one significant history record. For
example, an LED report that changes observed state and confirms a command
creates a state-report record and a derived terminal command record. Derived
history records are not new input `PlatformEvent` envelopes.

The storage model keeps significant facts, raw telemetry, quarantine metadata,
the latest room projection, durable command outbox intents, simulator command
receipts and structured JSON stdout logs logically separate. The receipt table
shares the physical database but is accessed only through its source-owned
port. Logs correlate available `eventId`, `recordId`,
`commandId`, `deviceId`, `source` and `reason`, but are not domain history.

Every live history record and telemetry sample has a stable `recordId` that is
globally unique across history generations and volatile runtime sessions, plus
a `durability` discriminator of `durable` or `volatile`. Durable records also have
a monotonically increasing, database-global `storageSequence`; volatile records
never claim one. The bounded mixed feed orders newest first by `occurredAt` and
then by descending lexicographic `recordId` as the deterministic tie-breaker. It
does not use `storageSequence` for presentation ordering.

`recordId` identifies a logical record rather than one processing attempt. For
an input-derived record it is deterministically derived from the configured
source namespace, canonical input `eventId` and a stable record-kind
discriminator, so multiple facts from one input remain distinct. For a derived
command lifecycle record it uses `commandId` and lifecycle-kind identity; a
transition kind can occur at most once in the single lifecycle. Platform-
generated records such as `storage.gap.recorded` receive an ID before their
transaction and persist it with the record. These schemes are globally
namespaced by record family and configured source where applicable. Retry,
volatile-to-durable redelivery and SSE/HTTP views of the same logical fact
therefore reuse one `recordId`; unrelated generations or runtime facts cannot
collide. Exact string encoding remains contract-task work.

A durable physical row is identified by its generation and
`storageSequence`, not by a unique `recordId` constraint. While an accepted
event identity is active, it prevents a second row for that logical fact. After
that dedup horizon ends, a replay may receive a new storage sequence with the
same logical `recordId`; this matters for an immediately retired fact whose old
payload still exists only for cursor grace. The old row must already be retired,
so two rows with one `recordId` are never active simultaneously. A pinned cursor
uses storage sequence to preserve its physical snapshot, while the frontend
still collapses logical duplicates by `recordId`.

Each command projection and every accepted or rejected **admitted command
outcome** has two durability axes:

- `durability` describes whether the command intent/request is durable;
- `lifecycleDurability` describes whether the projection's current lifecycle
  state is durable.

On the synchronous HTTP response these axes describe only the admission outcome
carried by that response: the accepted lifecycle created by `202`, or the
terminal failed lifecycle of an admitted rejection. The response is not a
current command projection. Later dispatch, uncertainty or terminal processing
may change `lifecycleDurability`; the revision-linked SSE projection is
authoritative for that newer state.

An admitted rejection for a known device, including command-policy and active-
command conflict, always creates a `command.failed` significant fact and, where
the known-device projection permits it, a terminal recent-command projection.
`durability` describes the retained request-attempt context and
`lifecycleDurability` describes that terminal failure. Malformed transport,
unknown-device and `platform_recovering` errors occur before command admission;
they have no `commandId`, lifecycle fact or durability axes. Exact TypeBox unions
remain contract-task work, but this admission boundary does not. Bootstrap
`unknown` availability, health and
observation statuses use the durability of their containing projection: durable
after an available startup transaction, volatile when bootstrapped during
degraded startup. Later time-derived freshness changes preserve the durability
of their underlying observation evidence.

Availability evidence, health evidence and each capability observation status
carry their own `durability`. This preserves mixed projections, such as durable
availability with a newer volatile temperature observation, without reducing
the whole device to one misleading flag.

After recovery, a newly accepted durable fact may exactly match the current
volatile evidence for the same dimension, value and canonical `occurredAt`. In
that case preparation applies a durability-only projection change: it preserves
the value and evidence timestamp, upgrades only that dimension to `durable` and
publishes the applicable projection delta after commit. The fact remains outside
the feed when the ordinary classification says it is non-applying/no-change.
If the bounded feed or live telemetry cache still contains the same logical
`recordId`, that existing entry's durability and `storageSequence` are upgraded
in place and delivered as part of the projection delta; it is not appended as a
second feed/sample item.
Older evidence, an equal-timestamp conflicting value or mere checkpoint
persistence never upgrades durability. This is source redelivery through the
normal accepted path, not automatic outage backfill.

History exposes records whose canonical `occurredAt` is no more than 30 days
old. Quarantine metadata, which may not have a valid event timestamp, uses its
backend `recordedAt` instead. The storage adapter filters expired rows from
new pagination sessions and runs retention maintenance at startup, in each write
transaction and before capturing a first page. A restart or idle period
therefore cannot make expired data enter a new session.

Independent hard limits retain the 10,000 greatest
`(occurredAt, storageSequence)` raw telemetry rows per device and the 5,000
greatest pairs among significant facts globally. Quarantine retains the 1,000
greatest `(recordedAt, internalSequence)` rows. Retention runs in the same
transaction as insertion and marks an evicted row with an internal retirement
timestamp instead of immediately deleting its payload. A late accepted record
outside the retained time or count window may therefore affect the current
projection according to normal domain ordering but is retired from new history
sessions immediately. Durable reads use the same keys, newest first; equal
event timestamps are ordered by `storageSequence`.

One active accepted-input identity references every significant-fact or raw-
telemetry record derived from that input `eventId`. Retention removes that
identity atomically only when the last such record is retired. An input that
creates multiple records therefore remains deduplicable until all of them leave
active retention; a record retired immediately provides no durable
deduplication guarantee after its transaction. Retired payloads remain only for
the cursor grace period below and do not keep the event ID active. Quarantined
identifiers never enter accepted deduplication. The degraded process keeps only
bounded in-memory deduplication and recent-feed state.

Every dedup identity also stores a canonical input fingerprint and its
`durability`. The fingerprint covers the validated semantic envelope and
payload after timestamp normalization: event type, canonical `occurredAt`,
source, applicable device/command IDs and validated payload. It excludes
additional envelope properties the event contract deliberately ignores. An
identical replay of a durable identity is the ordinary
quarantined duplicate. An identical replay of a volatile identity while still
degraded is likewise ignored in memory. The recovery checkpoint preserves
bounded volatile identities as reconciliation guards, but does not insert them
into accepted durable history.

When storage is available, an input whose `eventId` and fingerprint match a
volatile guard is prepared as **durability reconciliation**, not as a duplicate.
Its normal deterministic records are committed, matching projection/cache
evidence is upgraded as described above, and the dedup identity becomes durable
in the same transaction. This is the only replay exception and requires actual
source redelivery; recovery does not synthesize or backfill the input. Reuse of
either a durable or volatile `eventId` with a different fingerprint is
quarantined as `event_identity_conflict` and cannot alter projection, history or
the existing identity.

### Available, degraded and recovering operation

The room projection contains `platform.storage` with exactly three states:

- `available`: durable writes and durable HTTP reads are operational;
- `degraded`: SQLite cannot currently provide the required durable service;
- `recovering`: SQLite is write-capable, but reconciliation is not complete.

Every state carries `changedAt` and a machine-readable reason where applicable.
`changedAt` changes only when status or its reason changes, not for a
watermark-only update. `platform.storage.historyGenerationId` identifies the
database generation whose durable reads and watermark are being described. It
is present for `available` and for recovery of an existing valid database,
remains present after a runtime transition from `available` to `degraded`, and
is `null` when degraded startup cannot validate any history database and while
that first database is still being prepared in `recovering`. An empty valid database begins with
`storedThroughSequence: 0`; assigned durable record sequences start at 1 and are
never reused within that generation.
`storedThroughSequence` remains at its last known value after a runtime
transition to `degraded`; it is `null` together with `historyGenerationId` only
before the first valid database has committed, whether status is `degraded` or
`recovering`. The pair therefore never pretends that an unavailable unknown
history is an empty generation.
`platform.storage.storedThroughSequence` is the single current durable
watermark; it is not duplicated at the room-snapshot root. The same SSE
connection publishes a revision-linked `platform.updated` whenever storage
status changes, even if no device changes. The Dashboard shows a persistent
storage warning for `degraded` and `recovering`.

Every accepted durable history or telemetry commit advances that watermark.
When the commit also has a device or command delta, that outcome and its related
feed records or telemetry sample use revision N; a watermark-only
`platform.updated` follows at revision N+1. A durable accepted non-applying
outcome has no device/feed delta and publishes only the watermark update at its
next revision. Quarantine uses its separate internal sequence and does not
advance `storedThroughSequence`. This keeps `platform.storage` current without
mixing the SSE revision with the database cursor or duplicating related records.

All deltas caused by one processed operation form one ordered publication batch.
The serialized coordinator installs the final projection and queues the complete
batch before dequeuing another input, so another operation cannot interleave
between outcome revision N and its watermark revision N+1, between degraded N
and volatile result N+1, or between recovery reconciliation and available/gap.
A connection established during a batch receives a revision-0 snapshot of the
already installed final projection and subscribes only to later batches.

A durable `derived_projection` commit persists only the updated checkpoint/read
model and publishes its `device.updated` after commit. It creates no
`storageSequence`, does not advance `storedThroughSequence` and therefore has no
following watermark-only `platform.updated`. In degraded operation it applies
in memory. Freshness preserves the durability of its underlying observation
evidence in either case. A command timeout is not projection-only: it remains a
significant lifecycle fact with normal durable or volatile semantics.

In `degraded`, ingest, freshness evaluation, device projections, command
confirmation and timeout handling continue in memory. SSE continues to publish
honest volatile records and projections. Durable history, telemetry and
database-backed diagnostics endpoints return a structured service-unavailable
response; structured logs and live platform status remain available.

If a durable commit fails for a prepared input, the runtime first rolls back and
publishes `platform.updated(degraded)` at revision N. It then applies the same
prepared outcome in memory and publishes its volatile projection/history delta
at revision N+1. A quarantined or accepted non-applying outcome without a live
projection/feed addition needs only the status update and correlated log.

The runtime starts in `degraded` when startup meets an availability or
manual-intervention database failure. It
bootstraps configured devices, accepts live observations and permits volatile
commands instead of pretending that durable history exists.

### SQLite failure classification

This taxonomy applies to every operation on the shared Stage 4 SQLite file,
including history, checkpoint, outbox and simulator-receipt operations. Receipt
failures additionally report command-handoff evidence as defined below. Storage
errors have one of three reactions:

- **Automatically recoverable availability failure:** lock/busy exhaustion,
  transient I/O, readonly or unavailable path, disk-full and equivalent
  failures enter `degraded` and enable the five-second recovery probe.
- **Manual-intervention failure:** corruption, `not a database` and an
  incompatible database file enter `degraded`, preserve volatile realtime, and
  disable automatic recovery. The reason tells the operator that repair or
  replacement is required.
- **Fatal platform failure:** migration failure, unsupported schema version or
  startup invariant prevents backend startup. An unexpected constraint or
  programming invariant during runtime, or a transaction whose commit/rollback
  outcome cannot be proven, terminates the backend rather than reclassifying a
  platform defect or ambiguous side effect as an availability outage.

The adapter maps concrete SQLite codes into this taxonomy and preserves the
original code in the correlated log. An automatic probe runs every five seconds
and must reopen or validate the connection, confirm the expected schema and
complete a rollback-only write transaction. A read-only `SELECT` is not enough
to enter `recovering`.

If degraded startup occurred before any target database existed, the probe uses
an exclusive temporary SQLite file in the same directory. Inside a transaction
it executes the complete deterministic first-schema initialization and
rollback-only write check, then rolls back, closes and removes that probe file.
It does not create the target database or publish a generation ID. A migration
or initialization error is still fatal; only the original path/availability
failure is recoverable. An existing target database must validate its current
expected schema and is never migrated opportunistically by a runtime probe. The
only exception is a **pristine initialization candidate**: a valid SQLite file
with no application metadata or user tables, including a zero-length file that
SQLite can initialize, such as the empty file left when a first cutover crashed
before schema commit. It is not a valid history generation
and cutover may initialize it through the same first-schema transaction. If a
target appears between probe and cutover, cutover rechecks it; pristine may be
initialized, while any schema or data is reclassified through normal startup
validation instead of being overwritten.

Manual-intervention degraded does not poll or mutate the damaged database. The
operator repairs or replaces the file and restarts the backend; normal startup
validation then either opens it as `available` or applies the fatal startup
rules. Stage 4 has no live administrative recovery endpoint.

### Durable and volatile commands

When storage is `available`, accepting a `set.power` request uses one SQLite
transaction to persist `command.requested`, its projection and a durable outbox
intent. The outbox provides at-least-once delivery with a stable `commandId`.

The HTTP boundary returns `202` after that admission transaction commits, not
after adapter handoff. The first outbox attempt is the next immediate serialized
command task. In degraded operation, `202` follows volatile in-memory admission
and direct dispatch is likewise a subsequent immediate task. Dispatch lifecycle
SSE may reach the browser before or after its HTTP promise settles; the client
correlates by `commandId` and never treats response ordering as device outcome.

If that initial transaction fails with a confirmed rollback and the SQLite
error is availability-recoverable, the runtime publishes
`platform.updated(degraded)` first, admits the same generated `commandId` as a
volatile command and dispatches it once without an outbox or durable receipt.
The HTTP `202` response reports both durability axes as volatile after admission;
its immediate dispatch task remains outside the response outcome. Manual-
intervention storage failure uses the same volatile fallback after status
publication. Fatal or indeterminate transaction outcomes never dispatch.

While status is `recovering`, command admission is closed. A schema-valid race
with the disabled Dashboard control returns structured `503
platform_recovering` before generating a `commandId`; it creates no lifecycle or
feed fact and carries no durability axes. This is a retryable platform readiness
response, not a rejected command outcome. "Retryable" means the user may submit
again after storage becomes available; the frontend never automatically repeats
a user command.

An admitted known-device rejection uses the same durable-or-volatile commit
rule for its `command.failed` fact and recent projection, but never creates an
outbox or calls the adapter. A confirmed durable-write rollback publishes
degraded before the volatile failure; an indeterminate outcome is fatal.

The adapter dispatch result distinguishes:

- definite handoff, which includes the actual `handedOffAt` timestamp;
- definite no-handoff, which always produces `command.failed` and closes the
  outbox intent without retry once that terminal transition commits; if its
  durable write fails, the ordinary degraded volatile-terminal reconciliation
  rule still forbids redispatch;
- uncertain handoff, which means the source may already have received the
  command and therefore leaves the outbox eligible for idempotent retry.

Each delivery attempt records `attemptedAt`. A definite handoff supplies its
more precise `handedOffAt`; an adapter that cannot do so reports uncertain
handoff. A first uncertain attempt atomically persists a
`command.delivery_uncertain` lifecycle fact, changes the command to `pending`
and starts its 5-second confirmation deadline from that attempt's `attemptedAt`.
It does not claim that `command.dispatched` occurred. A matching state report
may still confirm this pending command because the first attempt may have
reached the source.

Stage 4 command projections replace the assumption that every `pending` or
terminal command has `dispatchedAt` with discriminated delivery evidence:

- `delivery.status: handed_off` carries `dispatchedAt` and `deadlineAt`;
- `delivery.status: uncertain` carries `firstAttemptedAt` and `deadlineAt`, with
  no `dispatchedAt`.

The chosen delivery evidence remains on the terminal projection and in
`recentCommands`. A later definite handoff replaces uncertain evidence with
`handed_off` and records its actual `dispatchedAt`, but retains the original
fixed `deadlineAt`. Exact TypeBox union construction remains contract-task work;
these alternatives and timestamp meanings do not.

The outbox retries an uncertain delivery after a fixed 500 ms, using an injected
clock and single-flight delivery per command, only while that lifecycle remains
active and before its fixed deadline. Recovery or process restart makes one
immediate retry when storage is available, then resumes the 500 ms schedule. A
retry never moves the deadline. A later definite handoff persists
`command.dispatched` with its known `handedOffAt`, but the timeout continues to
use the first uncertain `attemptedAt`. Confirmation, explicit source failure or
timeout closes the lifecycle and the outbox without another dispatch. If no
terminal result arrives before the deadline, the ordinary `command.timed_out`
transition wins before any attempt due at or after that deadline.

The durable outbox worker dispatches only while platform storage is `available`.
It pauses during `degraded` and `recovering`; in-memory confirmation, explicit
failure and deadline timers continue and may make the lifecycle terminal. After
recovery, terminal reconciliation closes the intent without dispatch. An active,
unexpired intent receives the documented immediate retry, while an expired one
becomes durable timeout first.

For confirmation timing, "arrives" means the coordinator's captured
`receivedAt`, not the device-controlled `occurredAt` or later dequeue time. A
matching report confirms only when `receivedAt < deadlineAt`. A report captured
before the deadline may still confirm after recovery queue delay. At or after
the deadline, the coordinator first materializes timeout if the command is
still active, then applies the report only to observed device state. FIFO
`ingestSequence` orders a pre-deadline report ahead of the subsequently enqueued
timer input.

After definite handoff, a second transaction persists `command.dispatched`,
marks the outbox intent delivered and starts the durable timeout from the actual
handoff timestamp. Synchronous adapter reports from a definite or uncertain
attempt are buffered until its dispatch or delivery-uncertainty transaction
commits. If that persistence fails, the runtime publishes `degraded`, establishes
the volatile pending lifecycle and only then applies the buffered report.

The receiving simulator/source owns command idempotency for at least the outbox
retention horizon, including across restart of that source. Delivered and
terminal backend outbox entries are retained for 30 days, matching the maximum
time-retention window for their command facts; pending intents are never evicted
by age.

For a command delivered from the durable outbox, before the Stage 4 simulator
consumes its selected scenario or schedules any native result, it durably
records a compact source receipt containing at least
`commandId`, a canonical command-payload fingerprint, the chosen scenario,
original due times and stable native outcome identities. Receipt persistence
and scenario consumption form the source's acceptance boundary. A repeated
`commandId` with the same fingerprint returns the stored logical result without
selecting or creating a second scenario. The same identifier with a different
fingerprint is a deterministic source invariant failure and never executes
either payload as a retry.

The simulator restores non-terminal receipts after restart and resumes the same
persisted plan with its original due times. The initial receipt already contains
the complete deterministic outcome payload/identity or an explicit no-output
plan. At due time the source normally marks that native outcome terminal before
emitting it; retry may safely re-emit the same stored result without inventing
another outcome. An overdue restored result is emitted immediately. An
omit-confirmation receipt is terminal with no native result to emit. Source
receipts remain for 30 days after terminal native handling; a non-terminal
receipt is not age-evicted. Stable native outcome identities keep repeated
emissions deduplicable after adapter translation. Future sources that cannot
provide this property cannot enable automatic outbox retry.

If the terminal-marker transaction fails with confirmed rollback, the shared
storage taxonomy runs first. After `platform.updated(degraded)`, the source may
emit the already persisted deterministic plan once from memory as a volatile
native result and remembers its completion for the process lifetime. Recovery
then marks the receipt terminal without redispatching the command. A crash before
that reconciliation restores the non-terminal receipt and may re-emit exactly
the same native identity; backend deduplication or durable redelivery makes this
safe. An indeterminate terminal-marker commit is fatal and emits nothing until
restart resolves the receipt. Thus source durability failure does not silently
invent a second outcome or unnecessarily stop a safely identifiable realtime
result.

The simulator owns this receipt boundary through a simulator-local receipt port.
For the in-process Stage 4 simulator, the runtime composition implements that
port with a logically separate table in the same SQLite database and through
the same connection owner as history and outbox. The simulator package does not
import backend storage internals. Receipt persistence is a distinct transaction
after the outbox transaction, so process failure between them remains a real
handoff boundary rather than being hidden by one cross-boundary transaction.

The receipt port distinguishes confirmed non-acceptance from inability to read
whether an earlier attempt was accepted. The former is definite no-handoff; the
latter remains uncertain because the same command may already have a persisted
plan or scheduled result. Both emit a correlated source log and, when no current
transaction outcome is ambiguous, the SQLite error follows the ordinary
platform taxonomy. The runtime first exposes any resulting storage transition,
then applies the corresponding volatile terminal or uncertain lifecycle exactly
as for another failed durable write. An indeterminate current receipt commit is
instead the fatal `storage_commit_outcome_unknown` case and publishes neither
lifecycle result.
The ordinary adapter handoff rules either close the command without retry or
retain the outbox for idempotent retry after storage recovery and before its
fixed deadline.

This co-location is an implementation choice for the in-process Stage 4
simulator, not a relaxation of source-owned idempotency. A later out-of-process
or hardware source must persist equivalent receipts on its side of the
transport before automatic retry is enabled.

A command created while backend storage is `degraded` is outside the durable
outbox guarantee. The simulator keeps only process-local idempotency for that
volatile `commandId`, does not require a durable source receipt and never
restores its plan after simulator restart. Because the backend never
automatically redispatches a volatile command, loss of that plan can only lead
to the existing confirmation timeout; it cannot create a later retry. Reuse of
the same volatile `commandId` with a different payload remains a process-local
invariant failure.

If storage fails after a definite or uncertain dispatch attempt but before its
lifecycle persistence, the durable intent remains durable while the in-memory
lifecycle becomes `pending` with `lifecycleDurability: volatile`. Its in-process
timeout starts from the actual handoff time, or from the first `attemptedAt`
when handoff was uncertain. Recovery behaves as follows:

- a lifecycle that already became terminal closes the outbox without
  redispatch;
- an active lifecycle is retried with the same `commandId`; its original timeout
  origin and deadline remain unchanged, and a later definite handoff records
  its own known handoff timestamp;
- an already expired deadline produces a durable timeout immediately during
  reconciliation and is never reconfirmed by a later report.

In `degraded`, a new command has `durability: volatile` and
`lifecycleDurability: volatile`. It dispatches directly without an outbox,
follows normal in-process confirmation/failure/timeout, is never automatically
retried and may disappear if the process fails before a recovery checkpoint.
An active durable command blocks a new volatile command for the same device.

### Automatic recovery, cutover and durable gap

A successful automatic probe enters `recovering`; new commands are temporarily
rejected. Observation ingest continues as volatile while the coordinator loads
the durable projection, deduplication state and outbox and merges newer memory
evidence by domain timestamp.

Recovery uses one serialized processing coordinator for every state-mutating
observation, lifecycle timer and internal transition. At cutover it lets the
currently dequeued input finish its volatile commit, establishes the boundary,
then stops dequeuing. Later raw inputs remain unprepared in a bounded FIFO queue
ordered by `ingestSequence` while they continue to be accepted. The recovery transaction checkpoints the
complete merged state through that cutover, including active commands and the newest 20 terminal
`recentCommands` plus the current bounded `recentEvents` projection cache, and
persists one derived significant
`storage.gap.recorded`. Inputs queued after the cutover are processed only after
the transaction commits: each is prepared against the recovered projection and
then uses durable semantics. No prepared result crosses the boundary with a
candidate projection derived from the wrong side.

When recovery began without a target database, that same cutover transaction
atomically creates the target schema, `historyGenerationId`, active runtime
session marker, checkpoint and gap. No valid empty generation is externally
observable before its recovery state exists. A crash before commit may leave a
pristine file but no target generation; a later cutover can safely retry first
initialization. A crash after commit restores the committed checkpoint and
normal unclosed-session rules apply.

The cutover queue has a configurable hard limit with a Stage 4 default of 1,000
inputs. If accepting another input would exceed it, the coordinator aborts the
recovery attempt, returns to `degraded`, resumes dequeuing the already queued
raw inputs in FIFO order, prepares them against the current volatile projection
and commits them with volatile semantics, including the new input. It never
drops or reorders an input merely to complete recovery.

A storage failure during reconciliation or the recovery transaction is
reclassified by the same SQLite taxonomy: a recoverable availability failure
returns to automatic-probe degraded, corruption enters manual-intervention
degraded, and a schema or platform invariant remains fatal. After a confirmed
rollback, either nonfatal degraded result aborts the barrier and drains every
queued raw input FIFO under volatile semantics. A fatal or indeterminate
transaction outcome publishes and drains nothing before process termination;
restart restores whatever SQLite actually committed.

`storage.gap.recorded` is derived operational history, not an input
`PlatformEvent`. It includes at least outage start and end, the failure reason,
the boundary basis and an explicit statement that outage observations were not
backfilled. Its canonical `occurredAt` is the successful cutover time, equal to
the recorded outage end, so feed ordering is deterministic. In the same process,
its start is the first transition to degraded.
After backend restart, the runtime uses the persisted
active-session metadata as a conservative lower bound and identifies that basis;
its end is the successful cutover time. Every available startup transaction
marks its runtime session active with `sessionStartedAt`. Transactions update
that session's `lastDurableCommitAt` whenever they persist the complete current
checkpoint; projection-only freshness and command/outbox transactions do so as
well. A quarantine-only transaction that does not persist the checkpoint does
not move it. For an unclosed session, gap start is the
later of those two timestamps: no work predates the session, and work through
the last durable commit is known to be stored. Clean shutdown closes that marker.
It first stops accepting new work and drains the serialized coordinator through
its last commit; if that sequence cannot finish, it leaves the marker active
rather than claiming a clean boundary.
The unclosed prior session is reconciled before the first snapshot and produces
the same conservative gap, including after an operator repairs a
manual-intervention database while preserving its metadata. If no durable
baseline or session marker has ever existed, degraded startup time is the
explicit conservative start basis.

Replacing a corrupt database is an explicit operator startup action rather
than something inferred from a missing file. The storage composition task will
choose the concrete one-shot CLI or configuration mechanism, but normal
startup must never silently overwrite or reinterpret an invalid database. On
explicit replacement, the backend preserves the invalid file for manual
inspection, creates a database with a new `historyGenerationId` and emits a
correlated `storage_history_replaced` JSON log containing the replacement time,
the new generation ID and the previous ID when it was still readable. Because
the old timeline is unavailable, it does not fabricate exact boundaries or
backfill a gap into the new generation. This manual replacement exception is
distinct from automatic recovery of the same database and from first-ever
creation when no database exists and no replacement intent was supplied.
Because the Stage 4 simulator receipts and backend outbox are co-located, the
new generation starts with both empty and never reconstructs or redispatches a
command from the replaced file.

The committed gap is a feed-worthy durable record delivered in the same
`platform.updated` revision that publishes `available` and its new
`storedThroughSequence`.

Recovery may also change the connected client's device collection, active or
recent commands, and bounded recent-event cache when durable state is merged
with degraded memory. After the recovery transaction commits, the coordinator
atomically installs the complete final room projection. For subscribers that
were already connected, it first emits one recovery-reconciliation
`commands.updated` revision containing the complete device and command
collections whenever any of those collections or non-gap feed entries differ;
the payload may therefore be unchanged command-wise. Its optional
`recentEvents` contains the complete bounded non-gap recovery cache and never
contains `storage.gap.recorded`; every client merges it by `recordId` and applies
the ordinary 20-entry bound. The following
`platform.updated` revision publishes `available`, the watermark and gap. A
connection established during publication reads the already installed final
projection as a revision-0 snapshot rather than observing a partially swapped
server state.

There is deliberately no telemetry or fact backfill for the outage. A volatile
command active at recovery remains volatile and is never redispatched. If it
conflicts with restored durable work for the same device, recovery waits for it
to become terminal before resuming that work. The platform never runs
overlapping active commands for one device.

Checkpointed `recentEvents` remain projection-cache entries with their original
durability markers; persisting the cache does not convert volatile outage facts
into durable HTTP history. A restart can restore those bounded explanations only
after they reached a checkpoint. Items lost before any checkpoint remain
represented only by the durable gap.

`recentEvents` and `recentCommands` are count-bounded projection caches, not
queries over currently active 30-day history rows. History retirement or
physical purge does not remove their entries and emits no removal delta; their
own deterministic order recomputes the greatest 20 only when a new eligible
cache entry is produced. Timestamps remain visible so an old last-known explanation is not
presented as recent in time. HTTP history independently enforces age/count
retention.

The same no-promotion rule applies to availability, health and observation
evidence, active and recent command intent/lifecycle markers, and bootstrap
`unknown`: checkpoint durability means the projection container can be restored,
not that its underlying outage facts entered durable history. A marker changes
to durable only when a later durable domain fact or explicit durable
reconciliation establishes that specific state.

An active volatile command included in a committed checkpoint is recoverable
only as an explanation, not as work. After a later backend restart, it is never
redispatched; before the first snapshot the runtime persists a terminal
`command.failed` fact with reason `volatile_command_lost_on_restart`. Its command
intent remains volatile while that new lifecycle fact and resulting
`lifecycleDurability` are durable.

At normal startup the runtime restores the latest checkpoint, including active
commands, the newest 20 `recentCommands` and its bounded `recentEvents` cache.
Before exposing the first snapshot, it reevaluates every configured freshness
policy against the injected startup clock and the restored `lastObservedAt`.
Any resulting `fresh` to `stale` change is a `derived_projection`: it is
persisted as part of startup reconciliation without creating history, feed,
deduplication or a storage sequence. This prevents downtime from leaving a
restored observation falsely fresh. The reevaluation preserves the durability
of the underlying observation evidence.
For Stage 4, `recentCommands` orders descending by its discriminated terminal
timestamp (`confirmedAt`, `failedAt` or `timedOutAt`) and then descending
lexicographically by `commandId`. Live insertion, checkpoint selection and
restart restoration use the same order and 20-entry bound.
It schedules remaining durable timeouts from stored deadlines; a deadline that
passed during downtime becomes terminal before the recovered projection is
exposed. A later report may update observed state but cannot reconfirm a
timed-out or failed command.

### Realtime and HTTP history synchronization

The frontend uses one `GET /room/realtime` SSE connection; Stage 4 adds neither
a second history stream nor replay. `room.snapshot` extends
`RoomSnapshotProjection` with a bounded newest-first `recentEvents` feed of 20
and `platform.storage`, which owns `historyGenerationId` and
`storedThroughSequence`.

Existing `device.updated` and `commands.updated` messages keep their projection
semantics and may carry either a `recentEvents` array produced by the same input
or one `telemetrySample`; they never carry both. The array may contain multiple
facts. Accepted telemetry that does not change current device state may still
produce `device.updated` with an otherwise unchanged device projection.

The one proposed recovery exception uses `commands.updated` as the existing
atomic full device/command projection carrier even when only recovery
reconciliation, rather than a new command fact, changed that payload. It may
carry the complete bounded non-gap recent-event cache, but no telemetry. This avoids
a new SSE type and preserves command/device reference invariants in one
revision.

`platform.updated` carries the complete current `platform.storage` projection
and may carry `recentEvents`, but never `telemetrySample`. In Stage 4 its
feed-bearing case delivers `storage.gap.recorded`. Every delta follows the
existing contiguous SSE revision rules.

In available operation, a projection and related live records share one SSE
revision and publish only after their SQLite transaction commits. In degraded
operation, the same atomic client-visible relationship is preserved in memory
with volatile markers. A process restart cannot recreate volatile feed items
that never reached a checkpoint; the later durable gap explains that loss.

Older significant facts, raw telemetry pages and bounded trends use HTTP. The
database assigns one global increasing `storageSequence` to durable history and
telemetry records. In one storage transaction, the first page performs due
retention, captures the current `historyGenerationId`, captures the current
maximum as `throughSequence` and captures the same injected-clock instant as
`retentionAsOf`. The response exposes all three session bounds. Every page includes rows whose
`storageSequence <= throughSequence` and whose internal `retiredAt` is absent or
later than `retentionAsOf`. It embeds all three session bounds with the last
`(occurredAt, storageSequence)` position and `historyGenerationId` in the opaque
cursor. An SSE revision is never a storage cursor.

The first page also canonicalizes a query fingerprint containing the dataset
kind and every result-shaping input: applicable device and metric identity,
requested time range, ordering and page size. The cursor binds that fingerprint
with the session bounds and position. A later page either derives those values
only from the cursor or requires repeated parameters to match exactly; it never
reinterprets one cursor under different filters. A mismatch returns a typed
cursor-query-mismatch response. Exact encoding remains deferred, but semantic
binding and validation are mandatory.

The cursor is server-issued and clients cannot author or alter its bounds,
expiry, position or query fingerprint. Its implementation must either be
tamper-evident or reference equivalent server-side state. Malformed, forged or
otherwise unverifiable cursors return a typed `invalid_cursor` response. Stage
4 does not promise cursor survival across backend restart; an invalidated
five-minute cursor starts a new first-page session while the client preserves
its bounded live overlay until the new baseline merges.

A pagination cursor expires five minutes after the first page; later pages do
not extend it. Retired row payloads are physically deleted only after the same
five-minute grace period, allowing every unexpired cursor to reproduce the
retention view captured by its `throughSequence` and `retentionAsOf`. An expired cursor returns a
typed cursor-expired response and the client starts a new first page. Exact
cursor encoding and endpoint paths remain deferred, but fixed-session expiry
and snapshot semantics are binding.

Every cursor is valid only for its captured history generation. If an available
current database has a different `historyGenerationId`, the API returns a typed
history-generation-changed response rather than evaluating the old sequence
against unrelated rows. If no validated generation is available because
storage is degraded, the existing structured service-unavailable response wins.
A database replacement may restart `storageSequence` at 1 because the
generation ID makes that namespace explicit.

An HTTP pagination session is a complete durable snapshot only through its
pinned `throughSequence`. Facts committed above that bound do not belong to
that session. SSE delivers every feed-worthy significant fact and telemetry
sample live, but it deliberately does not deliver accepted significant facts
classified outside the recent-event feed. Those non-feed facts become visible
only in a new HTTP pagination session or explicit refetch.

Before sending the first HTTP request, the client creates a live overlay and
buffers every SSE-delivered history or telemetry addition for the entire
pagination session, not only while one page request is in flight. Page changes
append their pinned results without replacing that overlay. When a response
arrives, the client merges the pinned HTTP result and overlay by stable
`recordId`: durable duplicates at or below
`throughSequence` collapse, durable SSE records above it remain live additions,
and volatile records remain because they have no storage sequence. The merged
feed uses the common `occurredAt`/`recordId` ordering. This guarantees no gaps
inside the pinned durable snapshot and no loss of SSE-eligible additions; it
does not promise live delivery of non-feed audit facts.

Cursor expiry or an explicit refetch starts a new pinned session but preserves
the current live overlay until the new baseline has merged. Closing the view may
discard it. The 20-entry feed limit and the telemetry view's bounded rendering
limit still apply with deterministic oldest-entry eviction. The client processes
every addition, but retaining more than the documented view bound is not part of
the no-loss guarantee; raw durable records that remain within storage retention
are available to a new HTTP session. The overlay therefore cannot turn the
frontend into an unbounded raw history cache.

A history-generation change is stronger than cursor expiry. The client retains
its last known non-null generation ID while a degraded snapshot or
`platform.updated` carries `null`. Every later non-null generation in either a
snapshot or `platform.updated` is compared with that retained ID. The same ID
means ordinary recovery and refetch. A different ID invalidates all
old-generation cursors, durable pages and live-overlay entries; the client
preserves the last rendered view only as visibly unavailable until the
replacement baseline arrives, then rebuilds from the current snapshot, HTTP
first pages and subsequent SSE additions. A client with no previous non-null ID
adopts the new one without treating first initialization as replacement.
Globally unique `recordId` values still prevent collisions, but records from
different generations are never merged into one pagination session.

On reconnect the client replaces its 20-entry feed from the revision-0
snapshot, refetches each open HTTP range and applies buffered additions only
after that baseline merge. A degraded 503 preserves current live data and marks
the durable view unavailable. The transition back to `available` triggers a
refetch of each open range before the durable view is considered complete. SSE
ignores `Last-Event-ID`.

Trend reads require `from < to` and `pointLimit >= 2`. They treat the requested
interval as half-open `[from, to)`, divide it into equal-duration half-open
buckets and emit the minimum and maximum from each non-empty bucket,
deduplicating them when they are the same sample. A sample exactly on an
internal boundary belongs to the later bucket; a sample at `to` is outside the
query. Equal minimum values choose the earliest
`(occurredAt, storageSequence)` sample in the bucket; equal maximum values choose
the latest. A flat bucket therefore keeps its first and last sample unless it
contains only one. The complete response orders those retained raw samples
ascending by `(occurredAt, storageSequence)`, independent of which one was the
value minimum or maximum. The backend uses at most
`floor(pointLimit / 2)` buckets, so the response never exceeds `pointLimit`.
In one storage transaction it runs due retention, captures
`historyGenerationId`, `throughSequence` and `retentionAsOf`, and computes only
from samples inside those bounds and the requested range. The response exposes
the bounds even though it has no pagination cursor. Every returned min/max point
is the original raw sample projection with its `recordId`, `storageSequence`,
timestamp, value and unit rather than a newly invented aggregate record. The
client can therefore deduplicate a concurrent SSE sample already represented by
the trend and retain live samples above the bound. Generation change and 503
recovery use the same refetch rules as paginated telemetry.
Exact TypeBox unions, endpoint paths and physical cursor encoding remain
follow-up contract work; the semantics above are binding once this ADR is
accepted.

## Consequences

The platform keeps realtime observation and local control useful during a
storage outage without presenting volatile data as durable. Recovery preserves
the latest honest state and explicitly records a history gap instead of
inventing backfilled facts.

This adds a platform storage projection, prepare/commit boundary, per-evidence
durability, serialized recovery coordinator and command outbox. Source-owned
idempotency is a prerequisite for automatic retry. Volatile commands remain a
deliberate availability trade-off and the Dashboard must keep that risk visible.

`synchronous=FULL` can make write latency visible at higher event rates.
SQLite-specific concerns stay inside the adapter, while storage-port,
transaction, recovery and deterministic timeout tests protect the behavior.

## Rejected Alternatives

- **Fail the whole platform closed:** unnecessarily loses fresh observations
  and local control when only durable history is unavailable.
- **Treat every SQLite error as recoverable:** would loop forever on corrupt
  files and hide migration or programming defects.
- **Silently buffer and backfill outage data:** cannot guarantee complete,
  correctly ordered input after process failure and would disguise the gap.
- **At-most-once command dispatch:** avoids duplicate delivery but can silently
  lose a durable intent at the ambiguous handoff boundary.
- **A separate SSE history stream, replay or `Last-Event-ID`:** creates a second
  retention and reconnection protocol.
- **Full event sourcing or an external database now:** exceeds the local
  reference slice's needs.

## Verification

Acceptance requires all of these outcomes:

- **AC-1:** Every SQLite failure maps to exactly one reaction: automatically
  recoverable degraded, manual-intervention degraded or fatal; volatile fallback
  requires a confirmed rollback.
- **AC-2:** Recovery has one serialized cutover; no input can be omitted from
  its checkpoint while also being treated as post-recovery durable work.
- **AC-3:** Outbox retry cannot create a second logical command or lifecycle for
  the same `commandId`, including after source restart; uncertain delivery uses
  one fixed first-attempt deadline, and definite no-handoff never retries.
- **AC-4:** Restart never redispatches a volatile command; a checkpointed active
  volatile command fails explicitly before the first snapshot.
- **AC-5:** The UI can distinguish command-intent durability, lifecycle
  durability, handed-off versus uncertain delivery evidence and every
  applicable dimension of device-evidence durability.
- **AC-6:** `storage.gap.recorded` reaches a connected client through the same
  SSE connection; any required full projection reconciliation precedes it, but
  the gap itself remains on `platform.updated`.
- **AC-7:** HTTP pagination is complete through its pinned bound and concurrent
  SSE-eligible additions merge without duplicates or loss other than documented
  bounded-view eviction; non-feed facts above the bound require a new HTTP
  session, retention cannot remove a row from an unexpired session, and an SSE
  revision is never a storage cursor. A cursor can never cross a history
  generation or be reused under a different query.
- **AC-8:** A no-change LED report without an active command remains outside the
  feed regardless of an earlier timeout.
- **AC-9:** These Stage 4 rules and all dependent ADR amendments are promoted
  together, so accepted ADRs do not retain conflicting realtime, command or
  evidence-durability rules.
- **AC-10:** A simulator receipt operation preserves definite non-acceptance,
  uncertain prior acceptance and fatal indeterminate commit as distinct cases,
  while a newly created volatile command bypasses receipt persistence and keeps
  its explicitly non-retrying path.
- **AC-11:** Every time-derived freshness evaluation is projection-only and
  cannot create history, feed, deduplication or a false watermark advance;
  command timeout remains a significant lifecycle fact.

The corresponding deterministic scenarios are:

- Inputs arriving before a recovery cutover appear in its checkpoint; inputs
  queued raw after the cutover are prepared only against the committed recovered
  projection and processed with durable semantics.
- A recovery write that rolls back drains its queued raw inputs as volatile in
  FIFO order after the degraded status; an indeterminate commit terminates
  without draining or publishing them.
- A future-dated report remains quarantined according to its captured ingress
  time even when recovery delays preparation until the device timestamp would
  otherwise fall inside the skew window.
- A crash or uncertain handoff followed by retry of the same `commandId` does
  not schedule a second simulator scenario or create a second lifecycle.
- A simulator restart after durable source acceptance restores its receipt; a
  backend retry does not consume another selected scenario, the original
  persisted plan resumes once, and reuse of the `commandId` with different
  intent fails deterministically.
- A due simulator result whose terminal-marker write rolls back first degrades
  platform storage and then emits the pre-persisted stable identity as volatile;
  recovery closes the receipt without command redispatch, and crash may only
  re-emit the same identity.
- An uncertain first attempt becomes pending, buffers any synchronous report,
  retains its first-attempt deadline across retries and times out before any
  attempt at or after that deadline; definite no-handoff fails once without
  retry.
- A matching report received before its deadline confirms despite recovery
  queue delay; one received at or after the deadline updates observed state only
  after timeout becomes terminal.
- Startup with a checkpointed active volatile command persists
  `volatile_command_lost_on_restart` without dispatch before exposing a
  snapshot.
- Startup reevaluates restored observation freshness against the injected
  current time before exposing a snapshot; elapsed downtime may make an
  observation stale but creates no history, feed, deduplication or watermark.
- A durable request with an unpersisted handoff projects `durability: durable`
  and `lifecycleDurability: volatile`.
- A command confirmed or timed out after only uncertain delivery keeps
  `firstAttemptedAt` and `deadlineAt` without inventing `dispatchedAt`.
- Successful recovery publishes `available`, its new watermark and
  `storage.gap.recorded` in one `platform.updated` revision.
- Recovery that changes restored devices, commands or cached feed first emits
  one full `commands.updated` reconciliation revision, then the gap-bearing
  `platform.updated`; a concurrently connecting client receives only the final
  snapshot baseline.
- Recovery after a backend restart derives the gap start conservatively from
  the later persisted `sessionStartedAt` and `lastDurableCommitAt`; an unclosed
  prior runtime session records its gap before the first snapshot.
- Clean shutdown closes its session marker only after input closure and
  coordinator drain; an interrupted drain leaves the marker active.
- An HTTP history request concurrent with durable and volatile SSE additions
  merges by `recordId` under its pinned bound and retains every SSE-eligible
  addition; a concurrent non-feed fact appears only after an explicit refetch.
- SSE additions arriving between two page requests remain in the session's live
  overlay and survive page merges or cursor restart.
- Retention during pagination retires rows for new sessions but an existing
  cursor continues through its pinned view until its fixed five-minute expiry;
  after expiry the client starts a new session.
- A telemetry cursor for one device, metric, time range or page size is rejected
  when presented under a different query instead of silently changing the
  pinned result set.
- A cursor created before explicit database replacement is rejected against the
  new `historyGenerationId`; the client discards the old generation and builds
  a new baseline instead of comparing or merging their sequences.
- Explicit database replacement starts with no inherited outbox or simulator
  receipt and cannot redispatch work from the inaccessible generation.
- A client that reconnects while generation is unknown retains its last known
  ID; a later `platform.updated` with the same ID performs normal recovery,
  while a different ID resets the old HTTP session and overlay.
- A simulator receipt failure with confirmed non-acceptance produces definite
  no-handoff, while inability to inspect a possible prior acceptance remains
  uncertain. The shared SQLite failure changes platform storage status before
  that volatile lifecycle result. An indeterminate current receipt commit is
  fatal and publishes neither. A later volatile command uses no durable receipt
  and receives no automatic retry.
- A no-change LED report after timeout remains auditable outside the feed and
  cannot change the terminal command.
- An unsupported schema prevents startup, while a transient write failure rolls
  back, publishes degraded before its volatile outcome and starts write probes.
- An indeterminate commit emits no SSE or adapter dispatch and terminates; after
  restart the recovered database alone decides whether that operation exists.

- Migration and storage tests prove deterministic schema upgrades, failure
  classification, confirmed rollback versus indeterminate commit, time/count
  eviction ordering and removal of an accepted `eventId` only with its last
  retained derived record.
- Processor tests prove prepare is non-mutating and each outcome reaches exactly
  one storage/history path.
- Freshness tests prove a derived projection commits before SSE without
  allocating storage sequence or platform watermark revision, including the
  volatile path.
- Runtime tests prove degraded ordering, write-capability probes, serialized
  cutover, temporary-file probing and atomic first-database/checkpoint
  initialization after an unavailable-path startup, safe retry from a pristine
  pre-commit file, rejection of partial/foreign schema, checkpoint/gap and no
  outage backfill.
- Command tests prove at-least-once outbox delivery, durable source receipts
  across source restart, payload-fingerprint conflict handling, definite
  handoff, terminal definite no-handoff, uncertain-handoff pending state, the
  fixed first-attempt deadline, 500 ms single-flight retry and volatile restart
  failure without redispatch. They also prove the transaction boundary between
  outbox and the co-located source receipt, shared storage-failure ordering and
  the receipt-free volatile path, including volatile emission of a pre-persisted
  outcome after confirmed terminal-marker rollback.
- Outbox tests prove degraded/recovering pause dispatch without pausing
  confirmation or timeout, and recovery never retries a terminal/expired intent.
- Projection tests prove two-axis command durability, per-evidence durability
  discriminated delivery evidence and checkpoint retention of 20
  `recentCommands` and 20 `recentEvents` without promoting volatile cache
  entries, device evidence or command lifecycle to durable facts.
- Projection-cache tests prove history retirement does not emit feed/command
  removal or alter the last-20 caches; only a new eligible cache candidate
  recomputes their deterministic greatest 20.
- Processor tests prove exact durable redelivery upgrades only matching volatile
  device evidence, while older/conflicting evidence neither regresses state nor
  changes durability or feed classification.
- Deduplication tests prove volatile guards survive checkpoint, identical source
  redelivery performs one atomic durability reconciliation, durable replay is
  still duplicate and fingerprint conflict is quarantined without mutation.
- Fingerprint tests prove canonical timestamp equivalence and ignored extra
  envelope fields do not conflict, while any semantic field change does.
- Record-identity tests prove retry and volatile-to-durable redelivery reuse one
  `recordId`, while multiple derived facts from one event and records from
  unrelated namespaces cannot collide.
- Retention tests prove a post-horizon replay can reuse logical `recordId` with a
  new physical sequence only after its former row retired, without breaking an
  existing cursor or showing two logical feed items.
- BFF and client tests prove multiple related facts in one revision,
  feed-bearing and watermark-only `platform.updated`, pinned generation and
  watermark merging, retention-safe cursor expiry, history-generation
  replacement, 503 recovery, reconnect refetch and no SSE replay.
- Runtime/BFF tests prove multi-revision publication batches cannot interleave
  and a connection opened during a batch receives one final snapshot baseline.
- HTTP contract tests prove that cursor query scope is canonical and immutable
  across every page.
- Cursor tests reject altered bounds, expiry, query and position and recover
  from restart invalidation through a new session without dropping the live
  overlay.
- Trend tests prove one bounded storage snapshot, half-open boundary assignment,
  minimum point-limit validation, raw-sample identity retention, point-limit
  enforcement and deduplication against concurrent live telemetry.
- A late no-change LED report remains outside the feed and cannot reconfirm a
  terminal command.

## Links

- Related architecture document: [System Overview](../architecture/system-overview.md)
- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related architecture document: [System Context](../architecture/system-context.md)
- Related decision: [Room Realtime Synchronization](adr-room-realtime-synchronization.md)
- Related decision: [Command Correlation, Confirmation and Concurrency](adr-command-correlation-confirmation-and-concurrency.md)
- Related decision: [Command History and Terminal Projections](adr-command-history-and-terminal-projections.md)
- Related decision: [LED Command Transport and Operational Defaults](adr-led-command-transport-and-operational-defaults.md)
- Related decision: [Server-Sent Events for the Realtime BFF](adr-server-sent-events-realtime-bff.md)
