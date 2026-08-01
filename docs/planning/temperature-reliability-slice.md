# Temperature Reliability Slice

This checklist defines when the simulated temperature sensor read path is good
enough to use as the reference pattern for later read-only sensors.

The slice remains read-only. It does not add temperature commands.

## Acceptance Checklist

- Normal telemetry is visible in realtime with sensor name, value, unit and
  last reading time.
- The UI shows recent temperature events so the current reading can be traced.
- When telemetry stops long enough to become `stale`, the UI keeps the last
  known reading visible and labels it as stale.
- When telemetry remains absent long enough to become `offline`, the UI keeps
  the last known reading visible and labels the sensor as offline.
- A fresh reading after stale or offline state returns the sensor to `online`
  and replaces the stale value with the fresh value.
- Duplicate platform events do not update current state or create duplicate
  recent event history.
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

1. Confirm that normal telemetry shows an `Online` reading and recent events.
2. Choose **Pause telemetry**; wait for the reading to become `Stale`, then
   `Offline`, while its last value remains visible.
3. Choose **Resume telemetry** and **Emit next reading**; confirm the fresh
   observation restores `Online` health.
4. Choose **Replay last reading**; confirm the current reading and event feed
   do not change, then use **Refresh diagnostics** in the dev panel to confirm
   `duplicate_event`.
5. Choose **Emit invalid reading**; confirm the current reading does not change,
   then use **Refresh diagnostics** to confirm `invalid_payload`.
6. Choose **Reset scenario**; confirm scheduled telemetry resumes from the
   deterministic first simulator value. Existing recent-event and diagnostics
   history remains available for inspection.
7. Stop and restart the local backend to confirm the frontend shows reconnecting
   state without erasing its last valid snapshot.

## Completion Rule

Temperature is complete when the checklist above passes and the UI can
demonstrate normal, stale, offline, recovery, duplicate, invalid and reconnect
flows without hiding uncertainty from the user.
