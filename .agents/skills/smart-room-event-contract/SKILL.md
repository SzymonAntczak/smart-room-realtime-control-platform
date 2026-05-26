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
- `docs/decisions/adr-command-correlation-confirmation-and-concurrency.md`
- `docs/decisions/adr-device-command-confirmation-and-health-policy.md`

## Contract Rules

- Keep event names as past-tense facts, for example `command.dispatched`.
- Keep command names as imperative intent, for example `set.power`.
- Require stable envelope fields: `eventId`, `eventType`, `version`,
  `occurredAt`, `source` and `payload`.
- Command lifecycle events must include `commandId`.
- Device state reports should not include `commandId` by default.
- Unknown event versions must not silently update derived state.
- Duplicate events must not create duplicate history entries.
- Malformed or invalid events should be rejected or quarantined rather than
  applied.

## Command Lifecycle

Preserve these states and transitions:

- `command.requested`
- `command.dispatched`
- `command.confirmed`
- `command.failed`
- `command.timed_out`

Requested state is not confirmed state. A late device report may update current
device state, but must not reopen or confirm an already timed-out command.

## Review Checklist

Check every event/command change for:

- traceability by `eventId` and `commandId`
- idempotency for duplicates
- explicit timing fields
- user-visible pending, failed and timed-out states
- compatibility with simulator scenarios
- tests for state derivation and lifecycle edge cases
