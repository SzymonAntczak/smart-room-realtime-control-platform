---
name: smart-room-event-contract
description: Use when designing, implementing, reviewing, or testing Smart Room events, commands, event envelopes, payloads, command lifecycle states, confirmation matching, duplicate events, stale/offline device state, or derived room state behavior.
---

# Smart Room Event Contract

Use this skill whenever code or docs affect the event and command model.

## Required Sources

Read these before changing behavior:

- `docs/architecture/events-and-commands.md`
- `docs/architecture/control-loop.md`
- `docs/architecture/devices.md`
- `docs/architecture/reliability-and-testing.md`
- `docs/decisions/adr-command-correlation-confirmation-and-concurrency.md`
- `docs/decisions/adr-device-command-confirmation-and-health-policy.md`

## Workflow

1. Summarize the binding contract from the required sources before changing or
   reviewing code.
2. Identify the affected event, command, projection, simulator or UI boundary.
3. Check whether the change preserves the documented contract shape,
   lifecycle, timing, validation and confirmation behavior.
4. Check whether tests or simulator scenarios cover the affected contract edge.
5. If behavior is ambiguous, recommend a documentation or ADR update before
   treating the new behavior as durable.
