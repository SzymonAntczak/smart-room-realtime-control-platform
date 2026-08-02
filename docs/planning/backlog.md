# Implementation Follow-ups

This list records deliberately deferred implementation work. It does not define
binding system behavior; promote a durable rule to architecture documentation or
an ADR as part of the related change.

- [x] Remove obsolete code and compatibility paths. The supported realtime and
      development-scenario contracts describe only the current behavior.

- [x] Remove short event history from realtime projections and dashboard cards.
      The dashboard shows only current device values. Event history and a
      per-sensor details entry point are deferred to a dedicated future slice.
      The realtime contract, projections, frontend and binding architecture/ADR
      documentation are aligned.

- [ ] Add a second simulated temperature sensor and cover two simultaneous
      temperature sensors end-to-end. Verify independent cadences, health,
      device-scoped scenario controls and per-device realtime updates without
      unnecessary updates to the other sensor card.
