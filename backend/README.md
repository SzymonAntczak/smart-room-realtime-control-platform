# Backend

The backend owns the local platform boundary between device-like sources and
the realtime UI. It translates external observations into platform events,
validates and deduplicates them, derives backend read-model projections, and
exposes UI-oriented realtime APIs.

The completed Stage 2/2.5 temperature slice runs a simulated sensor through
the adapter, event processor, projection and realtime BFF. It broadcasts
time-derived `stale` and `offline` health changes even while telemetry is
paused. Its development-only scenario endpoint drives the same simulator and
event path as normal readings; ignored duplicates and invalid payloads are
available through diagnostics. The Stage 3 LED reference slice adds explicit
HTTP command acceptance and realtime command lifecycle projections.

## Local SQLite storage

Stage 4 storage uses the Node `node:sqlite` API and requires Node `>=24.15 <25`.
Runtime composition resolves its local database to
`data/smart-room.sqlite` by default. Set `SMART_ROOM_STORAGE_PATH` to use a
different local path. Accepted events use the storage transaction path before
their projection is published; a confirmed storage rollback leaves the running
process explicitly degraded and continues with volatile realtime state.

If SQLite starts in `storage_manual_intervention_required`, an operator may
replace that inaccessible history only with the one-shot backend argument
`--replace-corrupt-storage`:

```bash
npm --prefix backend run dev -- --replace-corrupt-storage
```

Use the same `SMART_ROOM_STORAGE_PATH` value that identified the failed target.
The action refuses a missing, pristine, healthy or fatal-schema target. For an
eligible manual-intervention target it preserves the database and any SQLite
`-wal`/`-shm` sidecars in a sibling `*.replaced-<timestamp>-<id>` directory,
then creates a fresh history generation. It never imports history, checkpoints,
outbox intents or simulator receipts, and it does not create a storage gap. A
JSON `storage_history_replaced` log records the resulting generation and the
preserved path. Do not retain this argument in a service definition: it is an
intentional one-startup operator action.

Recoverable availability failures are probed at
`SMART_ROOM_STORAGE_RECOVERY_PROBE_INTERVAL_MS` (default `5000`). Recovery
uses a serialized cutover, persists one `storage.gap.recorded` checkpoint
boundary, and publishes reconciliation before the available watermark. The raw
cutover queue is bounded by `SMART_ROOM_STORAGE_RECOVERY_QUEUE_LIMIT` (default
`1000`); overflow aborts the cutover and preserves FIFO volatile processing.

## Structure

- `src/platform/` contains stable backend platform behavior shared by all
  sources.
- `src/adapters/` contains source-specific translators for simulators, hardware
  or external systems.
- `src/testing/` contains backend tests that span multiple backend boundaries.

## Commands

- `npm --prefix backend run dev`
- `npm --prefix backend run test`
- `npm --prefix backend run typecheck`
- `npm --prefix backend run lint`

The local development BFF listens on `http://localhost:4310` by default. The
frontend runtime reads room state from `http://localhost:4310/room/realtime` using SSE.
`GET http://localhost:4310/room` remains available as a debug/read snapshot
endpoint. Runtime event processing diagnostics are available at
`GET http://localhost:4310/diagnostics`. The port can be overridden with `PORT`.

Backend logs are structured JSON records written to stdout by the direct backend
process. Set `LOG_LEVEL` to one of `trace`, `debug`, `info`, `warn`, `error`,
`fatal` or `silent`; it defaults to `info` when unset or blank. An unsupported
value prevents backend startup before the runtime is initialized. The configured
level applies to Fastify request logs and backend startup and storage-migration
records. The root `npm run dev` launcher may prefix child-process output for its
own terminal presentation.

The in-memory event deduplicator can be configured at server startup with
`DEDUPLICATION_RETENTION_MS` (default `600000`) and
`DEDUPLICATION_ENTRY_LIMIT` (default `1000`). Both values must be positive safe
integers; an invalid value prevents the server from starting.

`npm run dev` from the repository root enables development-only device scenario
endpoints automatically. When starting the backend directly, set
`ENABLE_DEV_SCENARIOS=true` to expose those endpoints; leave it unset for the
normal backend runtime.

Use the repository architecture docs and accepted ADRs as the source of truth
for event, command, device and reliability behavior.
