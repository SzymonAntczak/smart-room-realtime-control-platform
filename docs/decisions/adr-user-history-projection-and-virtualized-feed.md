# ADR: User History Projection and Virtualized Feed

## Status

Accepted

Implementation partial: `ST-4-06a-01` supplies additive executable BFF contracts
and tested client validation adapters. `ST-4-06a-02` adds a tested BFF-local
transformer for room snapshots and atomic publications. It remains disconnected
from the current room HTTP/SSE transport. `ST-4-06a-03` delivers the separate
pinned user-history HTTP endpoint; frontend/live integration, rendering and
parent-story verification remain pending in `ST-4-06a-04` through `-06`.
The completed `DS-4-06` still exposes the
significant-fact feed with separate command lifecycle entries and expandable
technical details until its successor story is implemented.

This ADR supersedes the Stage 4 storage ADR's product-feed presentation and
total view bound for the DS-4-06a target. Significant-fact contracts, processor
classification, database rows/schema, lifecycle, durability, retention and raw
history cursors remain unchanged.

## Context

The current feed exposes requests, dispatch, delivery uncertainty, state reports
and confirmation separately. That explains the technical control loop, but a
user needs to understand observed changes and unsuccessful attempts without
interpreting that sequence or opening diagnostic details. The current Dashboard
also renders only its recent snapshot cache, despite existing HTTP cursor
pagination.

Aggregating raw facts independently on each frontend page would split related
facts across pages, risk duplicate results and move backend interpretation into
the UI. Infinite scrolling also needs separate limits for retained data and
rendered DOM, and must not interrupt a user reading older history.

## Options Considered

- Keep the technical feed and simplify only its labels.
- Aggregate raw HTTP pages and command events in the frontend.
- Derive user entries on demand by joining complete command sequences.
- Transform the existing current/history projections at the BFF boundary.
- Change significant facts or persist a second database projection.

## Decision

### Product presentation and classification

The BFF is the sole owner of transforming existing platform projections and
significant facts into user-history responses. It derives the presentation at
the HTTP/SSE boundary and emits no new domain event. The event processor,
read-model projection, significant-fact contracts and stored fact rows remain
as implemented by DS-4-06. The frontend validates and renders BFF user-history
items; it never interprets or aggregates raw command sequences.

An entry's title is the localized device display name. Its description explains
the change or unsuccessful attempt and includes the event date and time using
the existing browser locale/time-zone formatting. There is no expandable detail
section, raw payload, command identifier, transport label or technical reason
code. Technical facts and correlated operational logs remain available for
diagnostics; this decision adds no administrator screen.

The room-level history-gap exception uses the title "Room history" and explains
the missing interval. Volatile entries and unavailable or last-known history
remain honestly labeled in user language; removing diagnostics must not hide
uncertainty or imply restart-safe data.

| Backend result                                                              | User-history entry                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Requested, dispatched or delivery-uncertain command                         | None; progress remains at the device control.                                                |
| Applying power report changes observed state and confirms a command         | One observed state change; no separate confirmation entry.                                   |
| Command confirmed without an observed state change                          | None.                                                                                        |
| Applying power report changes state without confirming a command            | One observed state change, without claiming its cause.                                       |
| Explicit terminal failure, including admitted known-device rejection        | One unsuccessful attempt.                                                                    |
| Terminal timeout                                                            | One missing-confirmation outcome; never claim the device certainly did not act.              |
| Applying report changes state after timeout                                 | A separate observed change; preserve the earlier timeout.                                    |
| Applying availability or health value changes                               | One change, based on actual projection values rather than producer-declared previous values. |
| Storage gap                                                                 | One room-level missing-history interval.                                                     |
| No-change or non-applying report, telemetry, duplicate or quarantined input | None.                                                                                        |

Classification uses existing BFF-boundary facts and before/after device
projections when available. It compares observed domain values, not
timestamp/durability-only updates. A previously unknown value must not be
rendered as a known prior value or as proof of physical actuation. Matching
state confirms an outcome, not that frontend intent caused it. A non-matching
change during a pending command is an independent observed fact; the command may
later fail or time out normally. For older raw facts, omit a change whenever the
retained facts do not prove it; producer-declared previous values alone are not
proof that the projection applied the transition.
Pre-admission transport errors and `platform_recovering` responses create no
command-history entry, consistently with the existing admission rules.

### BFF response contract

The BFF will return a user-facing history response for current and paged history.
Its presentation data uses source identity and event time, with existing
durability bounds where known. It excludes translated sentences in platform
records, raw payloads, command IDs and diagnostic reason strings. The response
contract is defined in `ST-4-06a-01`; it does not alter platform
`RecentEventProjection`, durable significant facts, processor results,
checkpoints or stored database records.

#### Executable contract delivered by ST-4-06a-01

`@smart-room/contracts/user-history` owns TypeBox schemas and semantic guards
for the presentation contract. `UserHistoryItem` is discriminated by `kind`:

| Kind                   | Presentation data beyond common fields                                              |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `power_changed`        | `previous: on/off/null`, `current: on/off`                                          |
| `availability_changed` | `previous: online/offline/unknown/null`, `current: online/offline/unknown`          |
| `health_changed`       | `previous: healthy/degraded/unknown/null`, `current: healthy/degraded/unknown`      |
| `attempt_failed`       | Optional `requestedPower: on/off`, only when the target is known                    |
| `confirmation_missing` | Required `requestedPower: on/off`; absence of confirmation does not prove no action |
| `history_gap`          | `outageStartedAt`, `outageEndedAt`; a room-level entry                              |

Every entry carries its source fact's `recordId`, canonical UTC `occurredAt`,
`source` and `durability`. Durable entries require `storageSequence`; volatile
entries forbid it. Device entries carry `deviceId` and `deviceName` (the current
device display-name fallback, localized in the browser by device identity).
The room gap has no device fields and uses source `backend`. A known previous
value must differ from the current value. `null` means the previous value is
not evidenced; it is distinct from a known domain value of `unknown`.
The gap interval is chronological and its end equals `occurredAt`.
No item includes translated sentences, raw payloads, command IDs, technical
reason strings, or command-progress/confirmation entries. Structural validation
cannot prove that a transition applied: the later BFF transformation must still
enforce the classification and retained-evidence rules above.

`@smart-room/contracts/room-bff` exposes `RoomBffSnapshot` and
`RoomBffRealtimeServerMessage`, separate from platform projections and runtime
publications. It replaces `recentEvents` with `userHistory` at the corresponding
snapshot/delta positions, retaining all other current room/command/storage and
telemetry fields, the four existing message names and revision envelopes.
The snapshot allows 0–20 entries; an optional delta addition contains 1–20.
Collections have unique IDs and presentation order `(occurredAt, recordId)`
descending. Device additions must refer to the updated device and cannot share
one delta with a telemetry sample. Existing platform semantic guards validate
the unchanged projection portion; the new guards do not duplicate command or
storage rules. Live sequences are not compared with the preceding watermark,
since its update follows at a later revision.

`UserHistoryPage` carries durable-only `items`, `historyGenerationId`,
`throughSequence`, `retentionAsOf`, `pageSize`, opaque `nextCursor` or `null`,
and `completeness: retained_evidence_only`. The completeness label warns that
unproven transitions may be omitted; it does not assert exhaustive user history.
Pages have at most `pageSize` items (1–100), unique IDs and storage sequences,
and source order `(occurredAt, storageSequence)` descending. Each item sequence
is at or below the pinned watermark. Filtering permits short or empty pages
with a non-null next cursor, rather than falsely declaring the raw session ended.
The query accepts optional `pageSize` (integer 1–100, default 50) and an optional
nonempty `cursor`. The default applies to both first and continuation requests.
An omitted size therefore matches a cursor issued for 50; a cursor issued for
another size requires that same explicit size or returns `cursor_query_mismatch`.
The response and cursor scope always carry the effective size. The separate
BFF scope is `{ dataset: user_history, order: occurred_at_desc, pageSize }`;
it does not extend the storage port's raw cursor scope. Device/date filtering
belongs to `DS-4-06b`.
Existing typed cursor failures are reused; the shared unavailable response is
`{ error: durable_history_unavailable, message }`, matching current HTTP 503.

Client adapters validate decoded `unknown` HTTP/SSE data without coercion,
partial success or stripping extra fields. They return a validated page,
snapshot/message or a typed failure; they perform no fetching, event aggregation
or session/UI update. Production EventSource, history sessions and mocked-BFF
fixtures stay on the current raw contract until their integration subtasks.
Once integrated, the BFF/client use one strict current wire contract; the added
schemas are not a runtime compatibility union or a second SSE connection.

The BFF transforms data as it crosses its existing API boundary. For live
updates it uses the existing raw history additions and before/after room
projection already available to the BFF subscriber. For older history it reads
the existing pinned significant-fact pages, aggregates and filters them inside
the BFF, and only then returns user-history pages. It consumes and advances the
existing raw cursor internally; the browser receives an opaque cursor scoped to
the same pinned generation, watermark, retention view and expiry. The raw page
schema and rows are never rewritten. When retained evidence cannot prove an
older state change, the BFF omits that change and preserves an honest history
completeness label rather than guessing.

The BFF keeps no durable user-history copy. Durable facts continue to be written
and retired exclusively under the existing significant-fact transaction,
deduplication and retention rules. User item identity is derived from its
source record identity, making HTTP/SSE copies merge without a second event,
sequence, database table/column, checkpoint field, or migration. No changes to
the storage port or platform event-processing semantics are part of this
decision.

### HTTP and realtime boundary

Expose paged user history through the BFF by transforming the existing
significant-fact reader. Transform each pinned raw session in the BFF and filter
before returning user-facing entries. The browser never fetches or aggregates
raw facts for its product feed. Preserve the underlying page order
`(occurredAt, storageSequence)` descending, pinned `historyGenerationId`,
`throughSequence`, `retentionAsOf`, private retention revision, five-minute
expiry, 1–100 page-size limits, typed cursor errors and storage `503` behavior.
The BFF cursor binds its user-dataset scope to the underlying raw session; it
cannot be used as a raw significant-facts cursor.

`GET /room/history/user-history` uses one raw significant-fact page per user
page, with the effective `pageSize` (default 50). Filtering may yield fewer or
zero items while `nextCursor` still points to the next raw range. It does not
fill pages by consuming additional ranges. A BFF-local HMAC-SHA256 cursor binds
the user scope and unchanged raw cursor with a process-local random key. The
raw cursor remains the owner of pinned bounds, private retention revision and
fixed expiry; no database or storage-port change is needed.

Historical rows do not retain before/after projection evidence or the applied
classification. This endpoint therefore omits historical power, availability
and health changes. It returns failed attempts using only their own payload
for the optional target, history gaps, and timeouts whose matching retained
command request proves one consistent target. Current device names are display
fallbacks; current device state and terminal-command caches are not historical
proof. Entries for devices absent from the current configuration are omitted.

For timeouts on the main page, the BFF scans that page and older pages of the
same pinned session through its end, retaining only the relevant request
evidence. Missing or conflicting targets omit the timeout. Auxiliary reads
never advance the returned cursor: it wraps the main raw page's `nextCursor`.
Every raw page is validated and auxiliary boundaries/order must match. An
auxiliary read failure fails the whole response instead of returning partial
success. Pages without eligible timeouts need no auxiliary scan. A scan can
read the remaining retained history (at most 5,000 facts), but neither facts
nor user pages are cached across requests.

The BFF maps its existing room snapshot and `device.updated`, `commands.updated`
and `platform.updated` publications to user-history entries, without changing
platform publications or their raw `recentEvents` payload. Telemetry remains
separate. Existing atomic publication batches, `platform.storage`, generation
and watermark semantics remain unchanged.

The frontend uses BFF-provided user-history entries in place of technical
`recentEvents`; the BFF continues to consume the existing platform contract.
Do not change platform event shapes or add a second SSE stream. The raw
significant-facts API and its stored data remain intact for audit and other
technical consumers. Add no database migration: historical presentation is
transformed on read from currently retained raw facts.

### Infinite scroll, bounded memory and virtual rendering

Create the live overlay before the first HTTP request and retain it across
pages. Merge by `recordId`, preferring durable evidence; display newest first
using the existing `(occurredAt, recordId)` presentation order. HTTP cursor
position remains based on storage order, never the DOM index or SSE revision.

Load another page near the end of the virtual range with one request in flight.
Expose loading, explicit retry and the end of retained history. Invalid payloads
remain an error rather than triggering an automatic retry loop. Provide an
accessible "Load older" control using the same pagination operation.

Bound the loaded user-history cache and live overlay so memory remains limited.
Virtual scrolling renders the visible range with a suitable overscan and stable
item keys. Preserve list semantics, keyboard access, focus and desktop/mobile
layout. The implementation choices and exact limits are left to subtask
planning.

When the user is at the newest entries, normal live updates remain visible.
When reading older history, preserve the visible `recordId` and its viewport
offset and offer "New events" to return to the newest entries. Overlay overflow
must not grow memory or evict the older page currently being read; returning to
the newest entries refetches durable history so the overlay limit is not mistaken
for complete delivery of all intervening entries. Volatile eviction remains
subject to the existing bounded, non-durable guarantee.

Reconnect and cursor expiry obtain a new pinned session while preserving bounded
live additions. Rebuild through the previous anchor where it remains retained;
if retention removed it, explain that limitation and use the nearest retained
position. A changed generation invalidates all old cursors/pages/overlay and
restarts from the new baseline; unrelated generations are never merged. A
storage `503` preserves a labeled last-known view; availability recovery refetches
before claiming completeness. Closing the panel stops pagination, releases its
loaded pages and ignores late responses. Reopening uses the current validated
room baseline and the existing SSE connection.

## Consequences

The user sees one meaningful change instead of command internals, while the
technical audit remains complete and unchanged within its existing retention.
The BFF and frontend add a presentation contract, response transform and
stateful history view; the platform processor, facts, database and retention do
not acquire product-specific behavior. Reconstructing old changes is limited by
the evidence in retained facts, so the BFF may omit uncertain changes and label
the history boundary honestly.

## Rejected Alternatives

- Frontend aggregation cannot reliably combine raw chains split across pages
  and duplicates backend lifecycle interpretation.
- Persisting a second user-history table/column/checkpoint projection would
  change database semantics to solve a presentation problem.
- Asking the frontend to aggregate raw facts moves backend API semantics into
  the browser and cannot safely span cursor pages.
- An unlimited frontend cache would make DOM virtualization an incomplete
  resource bound.
- Treating timeout as definite failure, or later success, hides uncertainty or
  changes an already terminal lifecycle.
- Guessing historical transitions or replacing raw facts destroys trustworthy
  audit evidence.

## Verification

Contract and client-boundary tests for `ST-4-06a-01` cover the additive BFF
schemas and validation adapters.
The BFF-local snapshot and publication transformer is implemented and tested
under `ST-4-06a-02`; it is deliberately not connected to the room HTTP/SSE
transport. `ST-4-06a-03` adds contract, cursor, reader and HTTP/SQLite tests for
the optional size/default, conservative classification, cross-page timeout
evidence, sparse pages, signed dataset/scope separation, fixed expiry, pinned
retention/generation and whole-response error handling. Existing room/raw API
and runtime-bootstrap tests protect the unchanged transport boundaries.
Live integration, rendering and parent-story verification remain pending.
These tests do not establish that the running Dashboard already implements
this ADR's target feed.

## Links

- [Stage 4 Storage and Observability](adr-stage-4-storage-and-observability.md)
- [Room Realtime Synchronization](adr-room-realtime-synchronization.md)
- [Server-Sent Events for the Realtime BFF](adr-server-sent-events-realtime-bff.md)
- [Command History and Terminal Projections](adr-command-history-and-terminal-projections.md)
- [External Actuation and Command Outcomes](adr-external-actuation-and-command-outcomes.md)
- [Events and Commands](../architecture/events-and-commands.md)
- [Control Loop](../architecture/control-loop.md)
- [Reliability and Testing](../architecture/reliability-and-testing.md)
