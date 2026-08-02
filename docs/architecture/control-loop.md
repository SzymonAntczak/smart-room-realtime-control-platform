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
  -> platform confirmation event or state report
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
5. Accepted events update the backend read model/projections.
6. The realtime API/BFF reads the updated projections.
7. The frontend receives the updated state in realtime.
8. The event is stored for history and debugging.

## Command Path

1. The user sends a command from the frontend.
2. The UI may show the request as `submitting` while waiting for backend
   acceptance.
3. The backend accepts or rejects the command request.
4. After acceptance, the backend records the requested state as `accepted`.
5. Once it dispatches the command to an adapter, it marks it as `pending`.
6. A backend adapter translates the platform command into a device-native
   command for the simulator or hardware source.
7. The device or simulator eventually reports the observed state.
8. The backend adapter translates the report into a platform event.
9. The event processor updates the backend read model/projections when a
   matching confirmation arrives.
10. The realtime API/BFF streams the updated projection to the UI.

For the first implementation, a device can have only one active command
(`accepted` or `pending`) at a time. A new command for a device with an active
command is rejected as a
visible command failure instead of being silently queued or merged.

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
- stale device state should include the last known `lastSeenAt`

Command lifecycle events are correlated by `commandId`. Device reports remain
observable facts and confirm commands only when the reported state matches the
command's configured confirmation rule.

External timestamps may use a UTC offset. Contract validation normalizes every
accepted timestamp to canonical UTC (`Z`) before it enters the read model or
diagnostics.
