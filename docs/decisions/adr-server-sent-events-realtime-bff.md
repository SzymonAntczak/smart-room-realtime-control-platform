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

### Backpressure amendment

`ServerResponse.write()` returning `false` means Node accepted the frame into
its output buffer and needs the producer to wait for `drain`; it does not by
itself mean that the SSE client disconnected. The BFF therefore stops writing
until `drain` and retains the remainder of the active publication batch plus
at most one subsequent complete batch. It preserves the batch order and their
assigned revisions while draining.

If another batch arrives before that one waiting batch can be drained, or if
the stream errors, is destroyed or receives an invalid projection, the BFF
closes the stream and releases its subscription. The client then reconnects
for a fresh revision-0 baseline. This bounds BFF memory while avoiding a
spurious reconnect for the normal, short burst of command lifecycle updates.

### Stage 4 amendment

The Stage 4 storage decision retains this one SSE connection, revision
continuity, bounded backpressure handling and no-replay behavior. It extends the future
validated message union with `platform.updated`, and permits existing device or
command deltas to carry their related history records or telemetry sample.
`platform.updated` carries the complete platform storage projection and may
carry related platform history such as `storage.gap.recorded`. It never carries
telemetry. The projection includes the current `historyGenerationId`; a changed
non-null generation in a reconnect snapshot or later `platform.updated`
invalidates client-side HTTP history state from the previous database. A null
generation during degraded startup does not erase the client's last known ID.

It also carries watermark-only changes. An accepted durable device or command
outcome publishes its ordinary delta first and the updated storage watermark in
the next contiguous `platform.updated`; an accepted non-applying durable fact
needs only the platform delta.

Recovery may first publish one full `commands.updated` reconciliation delta for
restored device, command and non-gap feed-cache state, even when the command
collections themselves are unchanged. The next `platform.updated` carries the
available status, watermark and gap. This is the only non-command use of that
existing full-projection payload and does not add a new SSE type.

This amendment promotes the post-snapshot message list and the related message
semantics together with the Stage 4 storage decision.

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
