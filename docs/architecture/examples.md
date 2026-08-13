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

    simulator[Event Simulator] <-->|simulator-native MQTT| broker[(Local MQTT Broker)]
    broker <-->|MQTT| simAdapter[Backend MQTT Simulator Adapter]
    simAdapter -->|platform events| backend
    backend -->|platform commands| simAdapter

    backend -->|raw events and snapshots| storage[(Telemetry Storage)]

    hardware[Hardware Device later] <-.->|device-native MQTT| broker
    broker <-.->|MQTT| hwAdapter[Backend Hardware Adapter]
    hwAdapter -.->|platform events| backend
    backend -.->|platform commands| hwAdapter
```

After Stage 5, the simulator behaves like a real device source through the
local MQTT broker. It emits simulator-native MQTT messages, consumes
simulator-native MQTT commands and exercises failure modes before hardware is
introduced.

## Successful Command Confirmation

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Realtime Frontend
    participant EP as Event Processor
    participant SA as Simulator Adapter
    participant B as Local MQTT Broker
    participant S as Event Simulator
    participant Store as Telemetry Storage

    U->>UI: Turn led-main on
    UI->>EP: set.power command
    EP->>Store: command.requested(commandId)
    EP->>SA: dispatch set.power(commandId)
    SA->>B: simulator-native MQTT power command
    B->>S: simulator-native MQTT power command
    EP->>Store: command.dispatched(commandId)
    EP-->>UI: requestedState=on, command=pending

    S-->>B: simulator-native MQTT state report(power=on)
    B-->>SA: simulator-native MQTT state report(power=on)
    SA-->>EP: device.state.reported(power=on)
    EP->>EP: match report to pending set.power rule
    EP->>Store: device.state.reported(power=on)
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
    participant B as Local MQTT Broker
    participant S as Event Simulator
    participant Store as Telemetry Storage

    U->>UI: Turn led-main on
    UI->>EP: set.power command
    EP->>Store: command.requested(commandId)
    EP->>SA: dispatch set.power(commandId)
    SA->>B: simulator-native MQTT power command
    B->>S: simulator-native MQTT power command
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
    participant B as Local MQTT Broker
    participant S as Event Simulator
    participant Store as Telemetry Storage

    UI->>EP: set.power on for led-main
    EP->>Store: command.requested(cmd-123)
    EP->>SA: dispatch set.power(cmd-123)
    SA->>B: simulator-native MQTT power command
    B->>S: simulator-native MQTT power command
    EP->>Store: command.dispatched(cmd-123)
    EP-->>UI: command=pending

    Note over S,EP: Confirmation timeout expires

    EP->>Store: command.timed_out(cmd-123)
    EP-->>UI: reportedState=off, requestedState=on, command=timed_out

    S-->>B: simulator-native MQTT state report(power=on)
    B-->>SA: simulator-native MQTT state report(power=on)
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
    matcher --> room[Derived room state<br/>reportedState.power=on<br/>command=confirmed]
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

## Stage 4 Storage, History and Realtime Delivery

```mermaid
flowchart TD
    adapter["Backend adapter"] --> prepare["Processor prepare<br/>validate, deduplicate, classify<br/>without mutating projection"]
    prepare --> outcome{"Prepared outcome"}
    outcome -->|accepted applied| acceptedClass{"Accepted record class"}
    acceptedClass -->|significant| significant["Significant fact(s)"]
    acceptedClass -->|telemetry| telemetry["Raw telemetry sample"]
    outcome -->|accepted non-applying| nonApplying["Significant audit fact<br/>plus diagnostics"]
    outcome -->|derived projection| projectionOnly["Projection checkpoint only<br/>freshness, no record or watermark"]
    outcome -->|quarantined| quarantine["Quarantine metadata<br/>plus JSON log"]

    significant --> acceptedOutcome["Accepted prepared outcome"]
    telemetry --> acceptedOutcome
    nonApplying --> acceptedOutcome
    projectionOnly --> projectionOutcome["Derived projection outcome"]
    quarantine --> quarantinedOutcome["Quarantined outcome<br/>never accepted history"]
    acceptedOutcome --> storageState{"Storage status"}
    projectionOutcome --> storageState
    quarantinedOutcome --> storageState

    subgraph available["Available: durable path"]
        transaction["One short SQLite transaction<br/>record, deduplication, retention,<br/>projection or quarantine"]
        commandTxn["Command request transaction<br/>command.requested, projection,<br/>durable outbox intent"]
        database[("Shared Stage 4 SQLite<br/>historyGenerationId<br/>WAL and FULL")]
        outbox["At-least-once outbox worker<br/>stable commandId"]
        source["Idempotent simulator/source<br/>same commandId = same logical command"]
        sourceReceipts["Simulator-owned receipt port<br/>separate receipt table"]
        handoff{"Adapter handoff result"}
        dispatched["Dispatch transaction<br/>command.dispatched,<br/>outbox delivered, original handoff time"]
        transaction --> database
        commandTxn --> database
        database --> outbox
        outbox -->|durable delivery| source
        source <-->|durable outbox commands only| sourceReceipts
        sourceReceipts --> database
        source --> handoff
        handoff -->|definite| dispatched
        handoff -->|uncertain| uncertain["Persist delivery uncertainty<br/>pending, fixed first-attempt deadline"]
        uncertain -->|retry only while active<br/>and before deadline| outbox
        uncertain --> database
        handoff -->|definite no-handoff| commandFailed["Persist command.failed<br/>close outbox"]
        dispatched --> database
        commandFailed --> database
    end

    storageState -->|available| transaction
    transaction -->|commit succeeds| durableKind{"Committed class"}
    durableKind -->|accepted record| durableCommit["Commit accepted outcome in memory<br/>projection when applicable<br/>marked durable"]
    durableKind -->|derived projection| durableProjection["Install checkpointed projection<br/>preserve evidence durability"]
    durableKind -->|quarantine| durableQuarantine["Commit quarantine metadata and log<br/>no projection or SSE"]
    durableCommit --> liveDelta{"Live outcome delta?"}
    liveDelta -->|yes| outcomeSse["Outcome SSE revision N<br/>device/commands update"]
    outcomeSse --> watermarkSse["platform.updated revision N+1<br/>current storedThroughSequence"]
    liveDelta -->|no| watermarkOnly["platform.updated next revision<br/>current storedThroughSequence"]
    watermarkSse --> sse["One revision-linked SSE connection"]
    watermarkOnly --> sse
    durableProjection --> projectionSse["device.updated after commit<br/>no watermark revision"]
    projectionSse --> sse

    transaction -->|write fails| classifyError{"Classify SQLite error"}
    classifyError -->|migration, schema, invariant<br/>or indeterminate commit| fatal["Fatal startup/runtime error<br/>no publish or dispatch"]
    classifyError -->|corrupt or incompatible| manual["degraded<br/>manual intervention<br/>no automatic probe"]
    classifyError -->|availability failure| degraded["degraded<br/>platform.updated revision N<br/>correlated JSON error"]
    storageState -->|degraded| fallbackKind{"Memory class"}
    degraded --> fallbackKind
    manual --> fallbackKind
    fallbackKind -->|accepted record| volatileDelta{"Live projection, feed<br/>or telemetry?"}
    volatileDelta -->|yes| volatileCommit["Commit accepted outcome in memory<br/>marked volatile"]
    volatileDelta -->|no| volatileAudit["Keep bounded audit metadata<br/>and correlated log, no SSE"]
    fallbackKind -->|derived projection| volatileProjection["Apply projection in memory<br/>preserve evidence durability"]
    fallbackKind -->|quarantine| logOnly["Correlated JSON log<br/>no accepted history or projection"]
    volatileCommit --> volatileSse["Volatile result delta<br/>next revision; N+1 after first failure"]
    volatileSse --> sse
    volatileProjection --> volatileProjectionSse["device.updated<br/>next revision; N+1 after first failure"]
    volatileProjectionSse --> sse
    degraded --> probe["Every 5 seconds<br/>schema plus rollback-only write probe<br/>same-directory temp DB before first target"]
    probe -->|unavailable| degraded
    probe -->|reachable| recovering["recovering<br/>temporarily block new commands"]

    commandRequest["Command API request"] --> commandStorage{"Storage status"}
    commandStorage -->|available| commandTxn
    volatileCommand["New volatile command<br/>direct dispatch, no outbox,<br/>no automatic retry"]
    commandStorage -->|degraded| volatileCommand
    volatileCommand -->|process-local idempotency only| source
    volatileCommand --> sse
    commandTxn -->|write fails| classifyError
    dispatched -->|write fails| classifyError

    recovering --> reconcile["Continue volatile ingest<br/>load and merge durable state"]
    reconcile --> barrier["Serialized cutover barrier<br/>finish current input,<br/>queue later raw inputs"]
    barrier --> recoveryTxn["Recovery transaction<br/>schema and generation if first DB,<br/>checkpoint plus storage.gap.recorded"]
    recoveryTxn --> database
    recoveryTxn -->|commit succeeds| recoveryProjection["commands.updated when needed<br/>full recovered device and command state<br/>plus bounded non-gap feed cache"]
    recoveryProjection --> recoveredSse["platform.updated available<br/>new watermark plus gap"]
    recoveredSse --> sse
    recoveredSse --> durableOutbox["Resume eligible durable outbox<br/>then process queued input durably"]
    durableOutbox --> outbox

    sse --> dashboard["Dashboard<br/>projection, bounded feed,<br/>storage warning"]
    dashboard -->|older significant facts| eventHttp["HTTP cursor page<br/>with historyGenerationId<br/>and throughSequence"]
    dashboard -->|telemetry range or trend| telemetryHttp["HTTP cursor page<br/>or bounded trend"]
    eventHttp --> database
    telemetryHttp --> database
    degraded --> unavailableHttp["Durable history and diagnostics HTTP<br/>503 service unavailable"]
```

This target Stage 4 flow is not the current runtime. In the durable path, SSE is
published only after SQLite commit. If that commit fails, the already prepared
input is applied in memory as volatile after `platform.updated(degraded)`. Only
availability failures enable automatic probes; corruption requires manual
intervention, while migration, schema and programming defects are fatal.

Recovery does not backfill outage observations. Its serialized cutover
checkpoints every volatile outcome through one boundary, queues later inputs,
commits the gap and publishes it through `platform.updated(available)`. Later
queued inputs then enter the ordinary durable path. Filling the 1,000-input
cutover queue aborts that recovery attempt and drains the queue as volatile
instead of dropping input.

If the recovered projection differs from what an already connected client saw
while degraded, one full `commands.updated` reconciliation revision precedes
the available/gap platform revision. A new connection reads only the atomically
installed final snapshot.

One input may add multiple related feed records to the same revision, while raw
telemetry may add one sample for an open details view. HTTP returns durable
history through a pinned history generation and storage watermark. The client buffers every SSE
addition, merges by stable `recordId`, and reconnects from a new snapshot rather
than SSE replay. The pinned HTTP session is complete through its watermark;
retention tombstones preserve it for the cursor's fixed five-minute lifetime,
and non-feed facts committed later require an explicit refetch. A new history
generation rejects old cursors and resets the old pages and overlay instead of
merging reset sequences. Outbox retry is safe
only because the receiving source treats a stable `commandId` as one logical
command across source restart through its source-owned durable receipt, and
uncertain-delivery retry stops at the original deadline or any earlier terminal
lifecycle. In Stage 4 that source-owned port uses a separate table in the shared
SQLite database; future out-of-process sources own equivalent persistence on
their side of the transport. Volatile commands bypass durable receipts and are
never retried.
