# ADR: Server-Sent Events for the Realtime BFF

## Status

Accepted

## Context

The local BFF delivers UI-oriented room projections only from server to client.
The former WebSocket route had no application command ingress; commands already
use explicit HTTP requests. The projection protocol needs a snapshot baseline,
revision-linked deltas, boundary validation and visible recovery after a
connection failure, but does not need bidirectional transport.

## Decision

`GET /room/realtime` uses Server-Sent Events (SSE). Each existing validated
`RoomRealtimeServerMessage` is sent as a named SSE event whose `event` equals
its `messageType` and whose JSON `data` is the unchanged shared envelope.

The BFF sends one `room.snapshot` baseline after every new SSE connection and
then sends contiguous `device.updated` and `commands.updated` deltas. It does
not replay missed deltas and does not emit SSE `id` values: a reconnect obtains
a new revision-0 snapshot. The frontend closes a failed EventSource and retries
after its existing one-second delay, so browser-native retries cannot overlap
with the documented reconnect state.

SSE is strictly server-to-client. All application commands remain on the
validated `POST /room/commands` HTTP boundary. The local BFF sets standard SSE
content, no-cache and keep-alive headers, and releases projection subscriptions
when the HTTP stream closes or errors.
If an SSE write reports backpressure, the BFF closes that stream rather than
buffering revision-linked deltas; the client reconnects for a fresh baseline.

## Consequences

The browser uses `EventSource` and the BFF no longer needs a WebSocket route for
room projections. Snapshot, delta, command lifecycle and validation semantics
are unchanged. Clients cannot assume delivery while disconnected; the new
baseline is the recovery mechanism.

## Rejected Alternatives

- Retain WebSocket: it adds bidirectional transport capability not used by this
  BFF boundary.
- Add replay through `Last-Event-ID`: replay semantics would duplicate the
  existing snapshot-based recovery model and require a retention decision.

## Verification

- The SSE route returns `text/event-stream`, a validated snapshot baseline and
  only validated revision-linked deltas afterwards.
- A failed stream preserves the last valid UI projection, visibly reconnects
  and receives a fresh baseline.
- The stream accepts no command input; command requests remain HTTP POSTs.
- Closing an SSE client removes its projection subscription.
