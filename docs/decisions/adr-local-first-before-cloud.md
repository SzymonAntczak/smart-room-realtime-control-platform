# ADR: Local-First Before Cloud

## Status

Accepted

## Context

The initial platform scope should make the realtime room control loop
easy to understand, run and debug. Cloud features introduce additional concerns
such as authentication, remote access, synchronization, deployment topology and
external service failure modes.

Those concerns are important, but they can obscure the core model if they are
introduced too early.

## Options Considered

- Start local-first and add cloud integration later.
- Start cloud-first.
- Build local and cloud modes from the beginning.

## Decision

Keep the initial platform scope local-first.

The core control loop should be usable without external infrastructure. Cloud
integration can be added later as an adapter or deployment option rather than as
a dependency of the core model.

## Consequences

Local-first development keeps early iteration simpler and makes debugging easier.
The platform can demonstrate device state, commands, events and realtime UI
behavior without depending on external infrastructure.

Remote access, multi-user synchronization and cloud persistence are deferred.
When added later, they must preserve the same event, command and derived-state
contracts instead of replacing the core model.

Some design questions remain postponed, especially authentication, authorization,
multi-client consistency and conflict handling.

## Links

- Related architecture document: [System Context](../architecture/system-context.md)
- Related architecture document: [System Overview](../architecture/system-overview.md)
- Related architecture document: [Control Loop](../architecture/control-loop.md)
