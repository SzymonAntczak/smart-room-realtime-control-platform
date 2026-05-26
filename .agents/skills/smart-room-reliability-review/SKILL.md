---
name: smart-room-reliability-review
description: Use for Smart Room code review, design review, or test planning focused on reliability, realtime control UX, visible uncertainty, stale/offline handling, command failures, timeouts, simulator scenarios, and missing test coverage.
---

# Smart Room Reliability Review

Use this skill to review whether a change keeps the control system honest under
uncertainty.

## Sources

Read the relevant parts of:

- `docs/architecture/reliability-and-testing.md`
- `docs/architecture/control-loop.md`
- `docs/architecture/events-and-commands.md`
- `docs/decisions/adr-device-command-confirmation-and-health-policy.md`
- `docs/decisions/adr-command-correlation-confirmation-and-concurrency.md`

## Review Focus

Lead with risks and bugs. Prioritize:

- requested state shown as confirmed too early
- hidden pending, failed or timed-out commands
- stale or offline devices treated as healthy
- missing event history for user actions
- duplicate, delayed or missing events changing state incorrectly
- late confirmations changing closed command lifecycles
- missing tests for state derivation or user-visible reliability

## Expected Output

For code review, list findings first with file and line references when
available. Keep summaries brief.

For test planning, propose narrow tests around:

- normal command confirmation
- delayed confirmation
- command rejection
- timeout
- late confirmation after timeout
- stale and offline transitions
- reconnect with fresh state
