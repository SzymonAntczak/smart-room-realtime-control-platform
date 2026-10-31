# ADR: Telemetry History List

## Status

Accepted

## Context

A sensor needs a bounded live trend and a way to browse older retained raw
measurements. Filtering and paging the latter must not change the live trend
or the device event-history session.

## Decision

Device Details composes an independent live chart and static measurement list.
This supersedes the requirement for an equivalent table sharing the chart cache.
The chart retains its existing 200-sample HTTP/live cache and recovery behavior.
The list reads durable samples only through the existing telemetry HTTP API.
It never merges SSE or refetches on reconnect/storage recovery.

The list fixes the selected device and temperature metric. It loads one page
of 100 automatically after device validation and loads older pages only after
new user scroll input within 320 pixels of the viewport end. Measurement and
programmatic scrolling never cause paging. One request is active at a time.
The cache is bounded to 10,000 samples and 100 pages; reaching a local limit is
presented separately from reaching the end of retained data.

Optional From/To days are drafts until Search. Days include their complete
browser-local calendar day, including daylight-saving transitions, and become
UTC [from, to) bounds. Missing To resolves to the read start; missing From
resolves to 30 days before the effective To. Reversed or otherwise empty ranges
show a field error without HTTP. Bounds are fixed across pages. Refresh uses
applied criteria, recomputing omitted bounds; Clear removes dates and loads the
default selected-device range. Search, Refresh and Clear return to the top.

Pages retain descending (occurredAt, storageSequence) order and recordId keys.
Each record shows full local time, unrounded value and unit. Durable records
omit a durability label; volatile records show a warning tag beside the value.
The list has its own heading, no description and only the applied-criteria
summary between filters and records. Loading, empty, end, limit and error
states remain explicit. New queries hide
previous results until ready; paging retains loaded results. Errors show the
appropriate explicit retry or refresh action rather than stale results.

The first page pins generation, watermark and retention time. Continuations
must preserve them and the query. Cursor errors or pin mismatch require explicit
Refresh. Transport/503 failures can retry the failed page. Replacing criteria,
clearing, changing device or closing cancels previous work and ignores late
responses. Unrelated generations never merge. Backend contracts and retention
are unchanged.

The frontend `shared/infinite-scrolling` module owns generic bounded cursor sessions,
scroll input and virtual list rendering. History and telemetry supply separate
validated source adapters. Device filters have one local provider per consumer.
History live recovery and overlays remain owned by history.

## Consequences

The chart may contain newer or volatile observations absent from the static
list. They make independent HTTP reads. The chart shows its heading and a
200-sample window caption above the plot, with exceptional read states below
it. The chart retains its full accessible sample description. Current
temperature, observation freshness and observation time appear in a separate
card beside device information; device event history also has its own card.

## Rejected Alternatives

A shared live cache would couple browsing and chart updates. An unlimited cache
would leave memory unbounded despite virtual rendering.

## Verification

Test independent criteria, local-day/DST bounds, fixed continuation parameters,
limit versus end, concurrent calls, stale-response rejection, cursor/pin errors
and retry. Browser scenarios exercise desktop/mobile records, real-scroll-only
single-flight paging, bounded DOM and a live chart updating while the list stays
static until explicit refresh. Existing history anchor/focus behavior remains
covered, including resize and reconnect.
