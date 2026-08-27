# Control Loop

## Overview

```text
Device, simulator or external source
  -> device-native message
  -> backend adapter
  -> platform event
  -> event processor
  -> backend read model / projections
  -> backend realtime API / BFF
  -> realtime UI
  -> user command
  -> command dispatch
  -> backend adapter
  -> device-native command
  -> device, simulator or external source
  -> device-native confirmation or state report
  -> backend adapter
  -> platform state report
  -> updated backend read model / projections
  -> backend realtime API / BFF
  -> realtime UI
```

The platform is event-driven, but the user experience is command-driven. The user asks for something to happen; the system records the request, dispatches it and waits for evidence that the device actually changed.

## Read Path

1. A device, simulator or external source emits a device-native message.
2. A backend adapter translates the message into a platform event.
3. The event processor validates the event.
4. The processor applies deduplication and event-specific processing rules.
5. The runtime atomically persists the accepted fact or telemetry sample,
   accepted identity, retention result and candidate projection checkpoint.
6. After a confirmed commit, the runtime installs the projection in memory.
7. The realtime API/BFF reads and publishes the updated projections.
8. The frontend receives the updated state in realtime.

The Stage 4 processor separates non-mutating preparation from runtime
commit. With storage `available`, the durable record, deduplication state and
candidate projection commit atomically before SSE publication. If that write
fails, the platform changes to `degraded`, applies the prepared observation in
memory and publishes it as `volatile`. Realtime device truth therefore
continues, while durable history exposes an explicit gap instead of pretending
the observation was stored.

## Command Path

1. The user sends a command from the frontend.
2. The UI may show the request as `submitting` while waiting for backend
   acceptance.
3. The backend accepts or rejects the command request.
4. After acceptance, the backend records the requested state as `accepted`.
5. The backend hands the command to an adapter. Once that hand-off succeeds,
   it records `command.dispatched` and marks the command as `pending`.
6. A backend adapter translates the platform command into a device-native
   command for the simulator or hardware source.
7. The device or simulator eventually reports the observed state.
8. The backend adapter translates the report into a platform event.
9. The event processor updates the backend read model/projections when a
   matching confirmation arrives.
10. The realtime API/BFF streams the updated projection to the UI.

In the Stage 4 available path, acceptance also persists a durable
outbox intent before adapter dispatch. The at-least-once dispatch worker uses a
stable `commandId`, and the receiving source must treat its retries as one
logical command across its own restarts by persisting a source receipt before
scheduling native behavior. The simulator owns that receipt through a
simulator-local port. In Stage 4 the runtime implements that port with a
logically separate table in the shared SQLite database without exposing backend
storage internals to the simulator package. A confirmed failure before
acceptance is definite no-handoff, while inability to inspect a possible prior
acceptance remains uncertain; the SQLite error follows the same platform
failure taxonomy. An indeterminate current receipt commit is fatal. After a definite handoff, the runtime atomically
marks the intent delivered and persists `command.dispatched`; the timeout is
based on actual handoff time. An uncertain handoff conservatively makes the
command pending and starts the fixed timeout from its first attempt without
claiming `command.dispatched`; single-flight retries run every 500 ms, stop at
terminal lifecycle and never move that deadline. A definite no-handoff always
fails without retry. In degraded
operation, a newly accepted command is explicitly volatile: it bypasses the
outbox and durable source receipts, uses only process-local source idempotency,
is not retried automatically and may be lost on restart. Recovery
temporarily blocks new commands and never overlaps volatile and durable work for
one device.

The command HTTP request completes after admission, not handoff. The first
durable-outbox or volatile direct-dispatch attempt is an immediate subsequent
serialized task, and its SSE lifecycle may race the HTTP response at the client.
`commandId`, not transport arrival order, joins them.

An existing durable outbox pauses dispatch attempts while storage is degraded or
recovering, but its confirmation and timeout lifecycle continues in memory.
Recovery closes terminal work without dispatch and retries only active work
before its original deadline.

The initial durable receipt contains the complete stable native outcome plan.
If marking a due result terminal rolls back because shared storage became
unavailable, the platform publishes degraded first and the source may still
emit that pre-identified result as volatile. Recovery closes the receipt; a
crash can only cause the same native identity to be emitted again. An
indeterminate marker commit emits nothing and remains fatal.

For the first implementation, a device can have only one active command
(`accepted` or `pending`) at a time. A new command for a device with an active
command is rejected as a
visible command failure instead of being silently queued or merged.

## External Physical Actuation

A physical input may change a controllable device while a frontend command is
active. Its accepted state report always updates observed device state. A fresh
report that exactly matches a pending `set.power` request confirms that the
requested state was reached, but it does not prove that the frontend request
caused the change. A non-matching report leaves the command pending until its
normal failure or timeout outcome. Physical actuation never changes a timed-out
command back to `confirmed`.

## Requested vs Confirmed State

Requested state and confirmed state are different facts.

```text
User clicks: turn LED on
Requested state: LED on
Command state: accepted or pending
Confirmed state: LED off

Device reports: LED on
Requested state: LED on
Command state: confirmed
Confirmed state: LED on
```

The UI must not display a requested state as confirmed until the system receives a device report or another trusted confirmation source.

## Late Confirmation

A timeout closes the active command lifecycle. If a matching device report
arrives after the command has timed out, the processor still updates the
reported device state because the report is an observed fact. It must not change
the old command from `timed_out` to `confirmed`.

The late report should remain visible in history so the system can explain that
the device eventually reached the requested state after the command stopped
waiting for confirmation.

In the Stage 4 serialized coordinator, deadline matching uses the
backend `receivedAt` captured before queueing. A report received strictly before
`deadlineAt` may confirm even if recovery delays preparation; a report received
at or after the deadline updates observed state only after timeout becomes
terminal. Device `occurredAt` cannot extend the backend waiting window.

## Command History

`activeCommands` contains only `accepted` and `pending` work. Terminal
`confirmed`, `failed` and `timed_out` outcomes are exposed separately as a
bounded, newest-first `recentCommands` projection with their requested state,
relevant timestamps and failure detail. This UI-oriented history remains
separate from the future fact-oriented event-history slice. The full rule is in
[ADR: Command History and Terminal Projections](../decisions/adr-command-history-and-terminal-projections.md).

## Timing Rules

The control loop should make time visible:

- `requestedAt` records when the user or automation asked for the change
- `dispatchedAt` records when the backend sent the command
- `confirmedAt`, `failedAt` or `timedOutAt` closes the command lifecycle
- an observed state with applicable freshness should include `lastObservedAt`
- availability, stale observation data and a command outcome should remain
  independently visible

Command lifecycle events are correlated by `commandId`. Device reports remain
observable facts and confirm commands only when the reported state matches the
command's configured confirmation rule.

The first physical-input model deliberately does not require device reports to
carry `commandId` or a cross-boundary actuation-origin field. Its full trade-off
is recorded in [ADR: External Actuation and Command Outcomes](../decisions/adr-external-actuation-and-command-outcomes.md).

External timestamps may use a UTC offset. Contract validation normalizes every
accepted timestamp to canonical UTC (`Z`) before it enters the read model or
diagnostics.
