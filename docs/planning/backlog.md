# Implementation Follow-ups

This list records deliberately deferred implementation work. It does not define
binding system behavior; promote a durable rule to architecture documentation or
an ADR as part of the related change.

- [ ] Remove legacy code and compatibility paths that are no longer needed by
      the supported realtime and development-scenario contracts. Keep only
      explicitly documented compatibility where it remains intentional.

- [ ] Remove short event history from `device.updated` and dashboard cards.
      The dashboard should show only current device values. Add a per-sensor
      details entry point; history becomes available only in that future details
      view. Update the realtime contract, projections, frontend and binding
      architecture/ADR documentation together.

- [ ] Add a second simulated temperature sensor and cover two simultaneous
      temperature sensors end-to-end. Verify independent cadences, health,
      device-scoped scenario controls and per-device realtime updates without
      unnecessary updates to the other sensor card.
