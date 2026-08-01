# ADR: JSON Schema Transport Contracts

## Status

Accepted

## Context

Shared transport contracts currently use Zod-first schemas. The backend BFF
manually validates scenario input and manually serializes HTTP responses, while
the frontend validates received WebSocket messages independently. This makes
the JSON contract consumed by HTTP and realtime boundaries less explicit and
prevents Fastify from using its native validation and response serialization.

The platform must preserve the documented event envelope, BFF projections and
version-1 `room.snapshot` behavior. Timestamp values with UTC offsets must
still be normalized to canonical UTC before events reach projections or
diagnostics.

## Options Considered

- Keep Zod as the canonical contract format and adapt it to Fastify.
- Maintain separate JSON Schema for Fastify alongside Zod validators.
- Make JSON Schema authored with TypeBox canonical for shared transport
  contracts.

## Decision

Shared transport schemas are authored with TypeBox and are the canonical JSON
Schema representation. The shared package exposes these schemas for all
transport consumers and a small TypeBox runtime-check helper for boundaries
outside Fastify.

The shared runtime checker uses the full RFC 3339 `date-time` validator from
`ajv-formats`, matching the format implementation registered by Fastify's
default Ajv compiler.

Fastify uses the shared schemas as route `body` and successful `response`
schemas, allowing its native Ajv validation and response serialization to own
HTTP transport enforcement. WebSocket does not use Fastify's HTTP response
serializer, so the BFF validates every outbound `room.snapshot` immediately
before sending it; the frontend validates every received message before it
becomes renderable state. The current WebSocket route is server-to-client only.
Any future client-to-server WebSocket message must receive an explicit shared
schema and validation at the BFF receive boundary before it reaches platform
logic.

JSON Schema represents structural transport validity. The one active command
per device and `activeCommandId` reference rules remain semantic projection
invariants, checked alongside the `room.snapshot` transport schema. ISO
timestamp normalization remains an explicit boundary operation because JSON
Schema validation does not transform input values.

## Consequences

- HTTP input and successful HTTP output share the same canonical contracts as
  realtime messages.
- Contract consumers no longer depend on Zod runtime APIs.
- Fastify can reject malformed scenario requests and serialize documented
  successful responses without BFF-local schema copies.
- A new transport message requires a TypeBox schema, boundary validation and
  contract tests; WebSocket directions must be considered separately.
- Semantic validation and timestamp normalization remain deliberate code rather
  than hidden schema transformations.

## Verification

- Contract tests accept every documented event and reject malformed,
  unsupported or semantically inconsistent snapshots.
- Backend tests cover malformed HTTP scenario input and valid HTTP response
  serialization, plus initial and streamed `room.snapshot` delivery.
- Frontend tests continue to reject malformed realtime messages before UI state
  updates.

## Links

- Related architecture document: [Events and Commands](../architecture/events-and-commands.md)
- Related architecture document: [System Overview](../architecture/system-overview.md)
- Related architecture document: [Reliability and Testing](../architecture/reliability-and-testing.md)
