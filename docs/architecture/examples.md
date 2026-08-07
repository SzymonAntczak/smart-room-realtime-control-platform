# Architecture Examples

These examples turn the architecture decisions into concrete flows. They are
not implementation diagrams and do not describe the repository's current
runtime state. They show target behavior for backend-backed slices as the system
grows beyond the smallest read path.

## Local-First System Slice

```mermaid
flowchart LR
    user[User] --> ui[Realtime Frontend]
    ui -->|command request| backend[Event Processor]
    backend -->|state updates| ui

    simulator[Event Simulator] -->|simulator-native messages| simAdapter[Backend Simulator Adapter]
    simAdapter -->|platform events| backend
    backend -->|platform commands| simAdapter
    simAdapter -->|simulator-native commands| simulator

    backend -->|raw events and snapshots| storage[(Telemetry Storage)]

    hardware[Hardware Device later] -.->|device-native messages| hwAdapter[Backend Hardware Adapter]
    hwAdapter -.->|platform events| backend
    backend -.->|platform commands| hwAdapter
    hwAdapter -.->|device-native commands| hardware
```

This is the first useful backend-backed vertical slice. The simulator behaves
like a real device source behind a backend adapter: it emits simulator-native
messages, consumes simulator-native commands and exercises failure modes before
hardware is introduced.

## Successful Command Confirmation

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Realtime Frontend
    participant EP as Event Processor
    participant SA as Simulator Adapter
    participant S as Event Simulator
    participant Store as Telemetry Storage

    U->>UI: Turn led-main on
    UI->>EP: set.power command
    EP->>Store: command.requested(commandId)
    EP->>SA: dispatch set.power(commandId)
    SA->>S: simulator-native power command
    EP->>Store: command.dispatched(commandId)
    EP-->>UI: requestedState=on, command=pending

    S-->>SA: simulator-native state report(power=on)
    SA-->>EP: device.state.reported(power=on)
    EP->>EP: match report to pending set.power rule
    EP->>Store: command.confirmed(commandId)
    EP-->>UI: reportedState=on, command=confirmed
```

The UI may show the requested state as pending, but it must not present it as
confirmed until the processor receives matching device evidence.

## Timeout Before Confirmation

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Realtime Frontend
    participant EP as Event Processor
    participant SA as Simulator Adapter
    participant S as Event Simulator
    participant Store as Telemetry Storage

    U->>UI: Turn led-main on
    UI->>EP: set.power command
    EP->>Store: command.requested(commandId)
    EP->>SA: dispatch set.power(commandId)
    SA->>S: simulator-native power command
    EP->>Store: command.dispatched(commandId)
    EP-->>UI: requestedState=on, command=pending

    Note over S,EP: No matching adapter-produced device.state.reported arrives in time

    EP->>Store: command.timed_out(commandId)
    EP-->>UI: reportedState=off, requestedState=on, command=timed_out
```

A timeout closes the active command lifecycle, but it does not rewrite the
reported device state. The history should still explain what the user asked for
and when the request stopped waiting for confirmation.

## Late Confirmation After Timeout

```mermaid
sequenceDiagram
    participant UI as Realtime Frontend
    participant EP as Event Processor
    participant SA as Simulator Adapter
    participant S as Event Simulator
    participant Store as Telemetry Storage

    UI->>EP: set.power on for led-main
    EP->>Store: command.requested(cmd-123)
    EP->>SA: dispatch set.power(cmd-123)
    SA->>S: simulator-native power command
    EP->>Store: command.dispatched(cmd-123)
    EP-->>UI: command=pending

    Note over S,EP: Confirmation timeout expires

    EP->>Store: command.timed_out(cmd-123)
    EP-->>UI: reportedState=off, requestedState=on, command=timed_out

    S-->>SA: simulator-native state report(power=on)
    SA-->>EP: device.state.reported(power=on)
    EP->>Store: device.state.reported(power=on)
    EP-->>UI: reportedState=on, command=timed_out
```

The late device report updates `reportedState` because it is a real observation.
It does not reopen or convert the timed-out command into a confirmed command.

## Availability, Freshness and Recovery

```mermaid
stateDiagram-v2
    state availability {
        [*] --> unknown
        unknown --> online: explicit available evidence
        online --> offline: explicit disconnect or failed probe
        offline --> online: explicit reconnect or successful probe
    }
    state freshness {
        [*] --> unknown
        unknown --> fresh: accepted observation
        fresh --> stale: freshness window exceeded
        stale --> fresh: newer accepted observation
    }
```

Availability changes only from availability evidence. A later accepted
observation independently restores freshness. The UI may therefore show an
online device with stale data, or an offline device while retaining its last
known observation and command history.

## Command Correlation

```mermaid
flowchart TD
    cmd[Command request<br/>commandId=cmd-123<br/>commandType=set.power] --> requested[command.requested<br/>commandId=cmd-123]
    requested --> dispatched[command.dispatched<br/>commandId=cmd-123]
    dispatched --> pending[Pending command state]

    report[device.state.reported<br/>deviceId=led-main<br/>power=on] --> matcher[Confirmation matcher<br/>set.power exact power match]
    pending --> matcher
    matcher --> confirmed[command.confirmed<br/>commandId=cmd-123]
    confirmed --> room[Derived room state<br/>reportedState.power=on<br/>command=confirmed]
```

Command lifecycle events carry `commandId`. Device state reports remain observed
facts and confirm a command only through the configured matcher for that command
type.

## Overlapping Command Rejection

```mermaid
sequenceDiagram
    participant UI as Realtime Frontend
    participant EP as Event Processor
    participant Store as Telemetry Storage

    UI->>EP: set.power on for led-main
    EP->>Store: command.requested(cmd-1)
    EP-->>UI: cmd-1 accepted
    EP->>Store: command.dispatched(cmd-1)
    EP-->>UI: cmd-1 pending

    UI->>EP: set.power off for led-main
    EP->>EP: detect active command for led-main
    EP->>Store: command.failed(cmd-2, reason=command_already_active)
    EP-->>UI: cmd-2 failed, cmd-1 still pending
```

The first implementation allows only one active command (`accepted` or
`pending`) per device. Rejecting
overlapping commands keeps confirmation unambiguous and gives the UI a clear
failure to show.

## Device State Projection

```mermaid
flowchart LR
    events[Raw events] --> processor[Event Processor]
    processor --> projection[Device state projection]

    projection --> reported[reportedState<br/>confirmed observable state]
    projection --> requested[requestedState<br/>latest accepted intent]
    projection --> command[command<br/>idle, pending, confirmed,<br/>failed, timed_out]
    projection --> availability[availability<br/>online, offline, unknown]
    projection --> health[health<br/>healthy, degraded, unknown]
    projection --> freshness[freshness<br/>fresh, stale, unknown]
    projection --> history[event history<br/>auditable timeline]
```

The frontend reads the projection, not raw intent. This keeps the visible room
state aligned with the reliability rules: availability and stale data are
separate, pending state is visible, failures are first-class and confirmed state
is never faked from a request.
