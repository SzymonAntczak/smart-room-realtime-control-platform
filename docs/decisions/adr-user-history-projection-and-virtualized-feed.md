# ADR: User History Projection and Virtualized Feed

## Status

Accepted

This ADR supersedes the local storage ADR's product-feed presentation and
total view bound and owns product-history session behavior. Its live HTTP/SSE
overlay and automatic recovery rules apply to the Dashboard, while historical
search uses a separate static session. Significant facts carry versioned domain
processing evidence so retained durable entries can be reproduced after reload
and restart. Lifecycle, applicability, durability, retention and raw-history
cursor rules remain unchanged.

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

### Two history contexts

One `GET /room/history/user-history` endpoint serves two independent contexts:

| Context           | Query and updates                                                            | Session ownership                                                        |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Dashboard history | Unfiltered HTTP pages merged with the existing SSE connection.               | The Dashboard owns its pages, live overlay, cursor and reading position. |
| Historical search | Optional device/date filters, with static HTTP results and explicit refresh. | The modal owns separate criteria, pages, cursor and scroll position.     |

Search actions never replace, filter, reset or move the Dashboard session.
Both contexts reuse the user-item contract and appropriate rendering/pagination
primitives; the frontend never interprets raw facts. The live-session rules below
apply to Dashboard history, not to historical search. The search adds neither a
new endpoint nor another SSE connection.

### Product presentation and classification

The BFF is the sole owner of transforming existing platform projections and
significant facts into user-history responses. It derives the presentation at
the HTTP/SSE boundary and emits no new domain event. The platform records the
actual domain state before and after processing and the known command intent;
the BFF applies one presentation mapper to that evidence for live updates,
snapshots and historical pages. The frontend validates and renders BFF user-history
items; it never interprets or aggregates raw command sequences.

An entry's title is the localized device display name. Its description explains
the change or unsuccessful attempt and includes the event date and time using
the existing browser locale/time-zone formatting. There is no expandable detail
section, raw payload, command identifier, transport label or technical reason
code. Technical facts and correlated operational logs remain available for
diagnostics; this decision adds no administrator screen.

The room-level history-gap exception uses the title "Room history" and explains
the missing interval. Dashboard history labels volatile entries and
unavailable or last-known data in user language. A new historical search or
Refresh may retain prior data in session state while loading, but the UI shows
only loading feedback until new results are ready. A read error may retain prior
data in session state, while search shows only its error state until results are
ready.

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

Classification uses domain processing evidence and, for legacy live facts, before/after device
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

The BFF returns a user-facing history response for current and paged history.
Its presentation data uses source identity and event time, with existing
durability bounds where known. It excludes translated sentences in platform
records, raw payloads, command IDs and diagnostic reason strings. The response
contract has separate executable schemas. Platform `RecentEventProjection` and
durable significant facts carry optional versioned `processingEvidence`, with
event-specific actual before/after values and application status, or known
command intent. New relevant records require this evidence; its absence
identifies legacy records. It carries no presentation kinds or localized text.

#### Executable contract

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
and `completeness: retained_evidence_only`. This value marks that unproven
transitions may be omitted; it does not assert exhaustive user history.
Pages have at most `pageSize` items (1–100), unique IDs and storage sequences,
and source order `(occurredAt, storageSequence)` descending. Each item sequence
is at or below the pinned watermark. Filtering permits short or empty pages
with a non-null next cursor, rather than falsely declaring the raw session ended.
The query accepts optional `pageSize` (integer 1–100, default 50), an optional
nonempty `cursor`, and optional `deviceId`, `from` and `to` filters. The first-page schema
excludes `cursor`; the page schema supports both first and continuation requests.
The default size applies to both first and continuation requests.
An omitted size therefore matches a cursor issued for 50; a cursor issued for
another size requires that same explicit size or returns `cursor_query_mismatch`.
The response and cursor scope always carry the effective size. The separate
BFF scope is `{ dataset: user_history, order: occurred_at_desc, pageSize,
deviceId?, from?, to? }`; it does not extend the storage port's raw cursor scope.
`deviceId` is a nonempty string. Each provided time bound is an RFC 3339 timestamp
with UTC or an explicit offset, normalized to canonical UTC by the shared
normalizer. Date-only and timezone-free values are invalid. If both bounds are
present, `from` must be strictly earlier than `to`; either bound may be absent.
The filters combine with AND and apply to event `occurredAt` through a half-open
interval `[from, to)`, omitting the comparison for an absent bound. No filters is
a valid API query; the modal's minimum-one-filter rule is not an API constraint.
Schemas reject extra properties and malformed values; semantic normalizers
reject empty/reversed ranges without mutating input or filling absent filters.

`normalizeUserHistoryPageQuery` preserves optional filters and applies the size
default. `normalizeUserHistoryCursorQueryScope` canonicalizes the same filters
with a required effective size. `isMatchingUserHistoryCursorQueryScope` compares
the complete normalized scope: equivalent timestamp representations match, but
changed, added or omitted filters do not. Continuations repeat the original
filters and effective size; the cursor does not supply missing query criteria.
Any scope mismatch returns the existing `cursor_query_mismatch` failure instead
of reinterpreting the pinned session.
Existing typed cursor failures are reused; the shared unavailable response is
`{ error: durable_history_unavailable, message }`, matching current HTTP 503.

Client adapters validate decoded `unknown` HTTP/SSE data without coercion,
partial success or stripping extra fields. They return a validated page,
snapshot/message or a typed failure; they perform no fetching, event aggregation
or session/UI update. Production EventSource, history sessions and mocked-BFF fixtures use one strict current wire contract; the added
schemas are not a runtime compatibility union or a second SSE connection.

The BFF transforms data as it crosses its existing API boundary. For live
updates it uses the raw history additions with their captured domain processing
evidence. Legacy live classification uses the subscriber's before/after room
projection. For historical reads it consumes
the existing pinned significant-fact pages, aggregates and filters them inside
the BFF, and only then returns user-history pages. It consumes and advances the
existing raw cursor internally; the browser receives an opaque cursor scoped to
the same pinned generation, watermark, retention view and expiry. The raw page carries the evidence stored with each new relevant fact; migration
preserves existing rows without inventing missing evidence. When retained evidence cannot prove an
older state change, the BFF omits that change and preserves an honest history
completeness label rather than guessing.

The BFF keeps no durable user-history copy. Domain processing evidence is saved
with its significant fact and cached technical feed entry in the existing
transaction, deduplication and retention lifecycle. User item identity remains
the source record identity, so HTTP/SSE copies merge as one logical entry.
Evidence is committed before durable publication. A permitted promotion of a
volatile record preserves its original processing evidence rather than
reinterpreting the original change against the current device state. Bounded
volatile identity guards carry that domain evidence through cache eviction and
checkpoint recovery for as long as reconciliation remains allowed.

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

Device/date filters shape the returned user entries within that pinned raw
session. They do not narrow the retained evidence needed to transform facts
truthfully: a request outside the selected period may still prove the target of
a timeout inside it. Auxiliary reads retain their existing bounds and do not
advance the main cursor. A main raw page without matches can return an empty
user page with a non-null cursor; only exhaustion of the raw session ends
pagination. Device-filtered results omit room-level entries such as
`history_gap`. The response retains `completeness: retained_evidence_only`, but
the historical-search UI does not render a separate completeness notice.
Filtering does not reconstruct unproven historical transitions or hide read
failures through partial success.

For records with processing evidence, snapshots, live updates and history pages
use the same mapper. Only applied value changes produce power, availability or
health entries; no-change, stale and equal-timestamp non-applying reports remain
audit facts. Known command intent is retained with failures and timeouts, so
their descriptions do not depend on a surviving request or command cache.
Malformed present evidence fails the response rather than falling back to a
guess. Current device names remain display fallbacks; devices absent from the
current configuration are omitted.

Legacy records retain the prior safe rules: unproven device changes are omitted,
failed-attempt targets use their own payload, and timeouts require one consistent
retained request target. Migration preserves legacy records without inventing
missing evidence. Every newly evidenced durable user entry remains reproducible
while its source fact is retained in the same history generation, including
after browser reload, cache eviction and backend restart. Volatile entries retain
their existing bounded guarantee.

For legacy timeouts on the main page, the BFF scans that page and older pages of the
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
Platform input event shapes remain unchanged. The raw significant-facts API
exposes domain processing evidence alongside each evidenced fact. SQLite adds a
nullable evidence JSON column, and checkpoint version 5 preserves evidence in
recent technical records. Legacy data is retained. Historical presentation is
transformed on read; no additional SSE stream or durable user-history table is
created.

### Historical search interaction and lifecycle

The Dashboard feed's Filter control opens an accessible modal containing a
single-device select, From/To date inputs, Search, Clear filters, Refresh and a results
area below the form. Device options come from the current validated room
projection. Opening without an active search shows an instruction to choose at
least one criterion; it performs no history GET. Criteria are optional
individually. Submitting Search starts a new pinned search session with the
current criteria. Changing a filter or leaving that control performs no GET
and does not change displayed results. An empty form performs no GET, and
reversed selected dates show a field error without searching.

Draft criteria and applied criteria are separate. Editing drafts does not fetch
or change displayed results. Results show a small summary of their applied
criteria below the controls. Refresh is always available. Without submitted
criteria, it shows a temporary tooltip explaining that a filter must be selected
and submitted before refreshing; it performs no GET. Otherwise it starts a new
pinned session using the last submitted criteria and returns to the top; unsaved
drafts do not change the refresh scope. Clear filters removes drafts, results and the session, restores
the initial instruction and performs no GET.
Closing releases the session, clears the form and returns focus to the invoking
control. Each reopening starts with an empty form, no results or session, and
the initial instruction. The modal supports keyboard operation and contains
focus while open.

From/To selections include the chosen days in the browser's time zone. Convert
From to its local start of day, and To to the local start of the following
calendar day, then send UTC bounds for `[from, to)`. A missing day omits that
bound. Equal selected dates are valid; reversed selected dates block a search
and show a field error. Construct the next calendar day in the browser time zone
rather than adding a fixed 24 hours, so daylight-saving changes are respected.
The BFF does not interpret calendar dates or infer the browser's zone.

Search results are static. SSE additions, reconnect and storage recovery do not
merge results or automatically refresh the search. Infinite scroll and an
accessible Load older control fetch older pages from the same pinned search,
with one request in flight, bounded memory and virtual rendering. Sparse pages
with a cursor continue pagination. Show loading, no matches, retry and
end-of-history states; an empty intermediate page is not proof of no matches or
end of history. A new search or Refresh may retain prior results in session
state, but shows only loading feedback until the new results are ready. Read
errors may also preserve prior results in session state, but the search UI shows
only the error state until results are ready.

A new search, Refresh, Clear or close invalidates earlier requests/pages and
ignores late responses. Detected cursor expiry or session invalidation requires
explicit refresh rather than automatic rebuilding. Never merge unrelated
generations. Results and their scroll position remain independent of the
Dashboard throughout these operations.

Dashboard filtering, live search-result merging, multi-device selection, saved
searches, telemetry/technical-audit filtering and retention changes are outside
this decision. The domain-evidence SQLite and checkpoint migrations described
above are part of this decision.

### Dashboard infinite scroll, bounded memory and virtual rendering

Create the live overlay before the first HTTP request and retain it across
pages. Merge by `recordId`, preferring durable evidence; display newest first
using the existing `(occurredAt, recordId)` presentation order. HTTP cursor
position remains based on storage order, never the DOM index or SSE revision.

Load another page through the pinned Virtuoso list's `endReached` callback,
with `increaseViewportBy.bottom` equal to the current height of the history
content scroller. This starts paging approximately one viewport before the
physical end; the exact threshold follows Virtuoso's measured rendered range,
overscan and variable item heights. A list whose end is initially within that
range may page immediately when opened. Use one request in flight. Expose a
loading state, explicit retry after errors and the end of retained history.
Invalid payloads remain an error rather than triggering an automatic retry loop.
Keep the history title and footer controls outside the scrollable
content; scrolling applies only to the entries and their loading/end states.
The footer provides the Filter control that opens historical search and a
persistent Return to top control. Activating Return to top while already at the top gives a temporary
tooltip without refreshing history; returning from an older position retains
the existing newest-entry behavior, including a refetch after live-overlay
overflow.

Bound the loaded user-history cache and live overlay so memory remains limited.
Virtual scrolling renders the visible range with a suitable overscan and stable
item keys. Preserve list semantics, keyboard access, focus and desktop/mobile
layout. The session limits and measured rendering rules are defined below.

When the user is at the newest entries, normal live updates remain visible.
When reading older history, preserve the visible `recordId` and its viewport
offset and offer "New events" to return to the newest entries. Overlay overflow
must not grow memory or evict the older page currently being read; returning to
the newest entries refetches durable history so the overlay limit is not mistaken
for complete delivery of all intervening entries. Volatile eviction remains
subject to the existing bounded, non-durable guarantee.

Reconnect and cursor expiry obtain a new pinned session while preserving bounded
live additions. Rebuild through the previous anchor where it remains available;
if the entry is absent, explain the missing entry and use the nearest available
position without attributing the absence to retention without evidence.
A changed generation invalidates all old cursors/pages/overlay and
restarts from the new baseline; unrelated generations are never merged. A
storage `503` preserves a labeled last-known view; availability recovery refetches
before claiming completeness. Closing the panel stops pagination, releases its
loaded pages and ignores late responses. Reopening uses the current validated
room baseline and the existing SSE connection.

### Dashboard connected session limits and recovery

The frontend history session uses HTTP pages of 50, at most 5,000
cached HTTP entries and a separate 200-entry live overlay, with one active
fetch. During rebuilding, a labeled previous cache and its replacement may
coexist (two caches of at most 5,000 entries plus one overlay). Closing releases
both caches and aborts the operation; responses are also guarded by operation ID.
The overlay protects its current live reading anchor within its bound.

The session subscribes to the existing realtime connection before reading its
current baseline and starting HTTP. The port preserves the connection's last
known non-null generation alongside the current storage metadata, so opening
during an unknown degraded state cannot merge old live entries into a replacement
HTTP generation. Every validated addition reaches the
session directly; React snapshot batching cannot discard intermediate additions.
The first HTTP page pins generation, watermark and retention time. Paging
continues when Virtuoso reports the final loaded item in its extended rendered
range. Empty pages with a cursor continue directly because no item exists to
trigger `endReached`. The Virtuoso paging callbacks and explicit retry share
the same single-flight session operation. The frontend renders only a measured
virtual range; virtual indexes never
determine the HTTP cursor or change session limits.

Reading position is `{ recordId, occurredAt, offsetPx }` relative to the scroll
container and is restored before paint. Same-generation reconnect rebuilds
sequentially through that anchor. Expired or restart-invalid cursors restart
once per operation; a second failure requires explicit retry. Reconstruction is
limited to 100 pages per operation. A generation disagreement detected by HTTP
requests a fresh baseline by reconnecting the existing SSE. Changed generations
clear pages, cursor, overlay and anchor. A storage 503 retains the labeled view
and live additions; availability recovery refetches before clearing the warning.
Malformed responses and cursor-query mismatches do not start automatic loops.
Returning to newest after overlay overflow refetches durable history without
promising recovery of omitted historical changes or evicted volatile entries.

### Dashboard measured virtual rendering

The frontend uses the pinned `react-virtuoso` 4.18.16 component in the existing
history scroll container through `customScrollParent`. Entries are passed as
data and keyed by `recordId`; the initial item-size estimate is 192 px and at
least five items are overscanned on either side. Its measured list retains the
`ol`/`li` structure, item positions, and the existing accessible item IDs.

Virtuoso owns visible-range calculation, element measurements, variable row
heights, and scroll corrections after content or width changes. The history
position controller owns the durable reading identity `{ recordId, occurredAt,
offsetPx }`, restores it through public Virtuoso methods, handles return to the
newest entries and preserves the existing focus-recovery behavior. It does not
read or mutate a virtualizer geometry cache. Paging uses Virtuoso's
`endReached` callback with a bottom `increaseViewportBy` equal to the current
scroll viewport height. The history paging hook tracks Virtuoso's rendered
range to continue after sparse pages, updates the pixel buffer after viewport
resizes, and delegates single-flight request behavior to the session.

The list retains `ol`/`li` semantics, exposing each row's position. Its total
size is unknown (`aria-setsize=-1`) until the session reaches the end; the final
size describes available user entries, not raw facts or exhaustive history.
The scroll container is focusable with a visible focus indicator and supports
native keyboard scrolling. Static rows are not individual Tab stops. Navigation
controls stay outside recycled rows. If a focused control disappears, or loses
focus when disabled for loading, focus returns to the history container; moving
focus outside history prevents a later update from reclaiming it. Closing the
panel leaves focus at its toggle. No user-history wire contract changes.

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

Contract and client-boundary tests must protect the BFF schemas and validation
adapters. Transformer, cursor, reader and isolated HTTP/SQLite tests must cover
optional page size/default, conservative classification, cross-page timeout
evidence, sparse pages, signed dataset/scope separation, fixed expiry, pinned
retention/generation and whole-response errors. Platform/raw API and runtime
bootstrap tests must protect the unchanged internal contracts.

Filter contract tests must protect optional and combined criteria on first and
continuation queries, UTC/offset normalization, one-sided ranges, empty/reversed
ranges, strict unknown-field rejection and complete canonical cursor-scope
matching. BFF reader/HTTP tests must protect AND filtering by event time,
inclusive lower/exclusive upper bounds, retained evidence outside the requested
range, room-entry exclusion for device filters and sparse-page continuation.
Changed or omitted filters must produce typed cursor mismatch; storage and
main/auxiliary read errors must preserve whole-response failure.

Deterministic search-session tests must protect static results, applied versus
draft criteria, single-flight paging, explicit refresh after invalidation,
request replacement and cleanup. Mocked-BFF browser scenarios must protect
keyboard/focus behavior, same-day and one-sided dates, daylight-saving boundaries,
Search/Refresh/Clear, bounded virtual results and independence from the live
Dashboard. Opening, editing drafts, clearing and reopening without submission
must make no history GET. SSE updates must change only Dashboard history while
search results retain their pinned view.

Backend integration with mocked native sources and real SQLite/HTTP/SSE protects
BFF history identities, pinned pages, cursor errors and storage recovery.
Deterministic frontend history-session tests and mocked-BFF desktop/mobile browser
tests protect client merge, paging, anchors, bounded overlay, recovery and panel
cleanup. Root-level E2E smoke protects their actual system composition according
to [Test Suite Boundaries](adr-test-suite-boundaries.md). Item presentation and
browser scenarios must verify 1,000 loaded entries with bounded DOM, mixed-height
anchors through resize/reconnect, keyboard access, single-flight Virtuoso paging
and predictable focus. The sidebar title and footer remain visible while only
history content scrolls; Virtuoso begins paging when its final loaded item
enters the rendered range, extended by one current viewport height. The
persistent Return to top
control shows a temporary accessible tooltip when activated at the top.

## Links

- [Storage and Observability](adr-storage-and-observability.md)
- [Room Realtime Synchronization](adr-room-realtime-synchronization.md)
- [Server-Sent Events for the Realtime BFF](adr-server-sent-events-realtime-bff.md)
- [Command History and Terminal Projections](adr-command-history-and-terminal-projections.md)
- [External Actuation and Command Outcomes](adr-external-actuation-and-command-outcomes.md)
- [Events and Commands](../architecture/events-and-commands.md)
- [Control Loop](../architecture/control-loop.md)
- [Reliability and Testing](../architecture/reliability-and-testing.md)
