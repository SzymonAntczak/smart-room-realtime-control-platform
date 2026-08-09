# Temperature Reliability Slice

This checklist defines when the simulated temperature sensor read path is good
enough to use as the reference pattern for later read-only sensors.

The slice remains read-only. It does not add temperature commands.

## Acceptance Checklist

- Normal telemetry is visible in realtime with sensor name, value, unit and
  last reading time.
- Development diagnostics expose ignored duplicate and invalid telemetry without changing the
  current reading.
- When telemetry stops long enough to become `stale`, the UI keeps the last
  known reading visible and labels it as stale.
- Missing telemetry alone does not change availability. The UI keeps the last
  known reading visible and labels its observation as stale.
- Explicit device disconnection labels the sensor `offline`, stops periodic
  telemetry and retains the last known reading.
- Explicit reconnection restores `online` availability and resumes the
  telemetry schedule; a later fresh reading replaces the stale value.
- Duplicate platform events do not update current state.
- Invalid telemetry payloads do not update current state.
- Replayed or out-of-order device-like readings do not regress the current
  value.
- WebSocket disconnects are visible as stream reconnection state and do not
  erase the last valid snapshot.
- Invalid realtime snapshots are treated as contract errors and are not
  rendered as room state.

## Verification Commands

Run these before treating the slice as complete:

```bash
npm --prefix simulator test
npm --prefix backend test
npm --prefix frontend test
npm run typecheck
npm run lint
npm run format
```

## Local Manual Scenario Checklist

Run the backend and frontend locally with `npm run dev`. The development panel
is intentionally separate from the temperature control surface and is available
only in the local development build.

1. Confirm that normal telemetry shows `Online` availability, a fresh reading and its last-reading time.
2. Choose **Pause telemetry**; wait for the reading to become `Stale`, then
   while availability remains unchanged and its last value remains visible.
3. Choose **Resume telemetry** and **Emit next reading**; confirm the fresh
   observation restores freshness without changing availability.
4. Choose **Replay last reading**; confirm the current reading does not change,
   then use **Refresh diagnostics** in the dev panel to confirm
   `duplicate_event`.
5. Choose **Emit invalid reading**; confirm the current reading does not change,
   then use **Refresh diagnostics** to confirm `invalid_payload`.
6. Choose **Reset scenario**; confirm scheduled telemetry resumes from the
   deterministic first simulator value. Existing diagnostics remain available
   for inspection.
7. Choose **Mark device offline**; confirm the sensor becomes `Offline`, its
   last reading remains visible and no new periodic readings arrive. Confirm
   that telemetry scenario controls are unavailable.
8. Choose **Mark device online**; confirm the sensor becomes `Online` without
   immediately replacing its last reading, then wait for the next scheduled
   reading to refresh it.
9. Stop and restart the local backend to confirm the frontend shows reconnecting
   state without erasing its last valid snapshot.

## Completion Rule

Temperature is complete when the checklist above passes and the UI can
demonstrate normal availability, stale observations, explicit offline and
recovery, duplicate, invalid and reconnect flows without hiding uncertainty.

## Acceptance Record

The local manual checklist was completed successfully on 2026-08-01 against the
current read-only projection model. Event-history UI is deliberately deferred
to a dedicated future slice by the realtime synchronization ADR.
