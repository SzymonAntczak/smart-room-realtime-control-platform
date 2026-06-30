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

## Completion Rule

Temperature is complete when the checklist above passes and the UI can
demonstrate normal, stale, offline, recovery, duplicate, invalid and reconnect
flows without hiding uncertainty from the user.
