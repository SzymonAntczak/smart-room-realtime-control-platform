# Implementation Follow-ups

This list records small technical follow-ups deliberately deferred during
implementation. It does not repeat the product roadmap or define system
behavior.

- [ ] Migrate the backend HTTP runtime from the direct Node.js server to
      Fastify. Preserve the existing local BFF responsibilities, development
      scenario endpoints and `room.snapshot` WebSocket contract; choose and test
      the WebSocket integration before starting the migration.
- [x] Define and validate native-device to platform-device identity mapping at
      adapter boundaries. An adapter instance is bound to one native ID and one
      platform ID; reject unexpected native IDs. Introduce a mapping registry only
      when an adapter consumes a multiplexed native source.
- [x] Use one injected clock consistently across runtime, event processing and
      deduplication. Add a deterministic integration test for deduplication
      retention expiry.
- [x] Define and implement a clock-skew policy for future-dated device reports.
      Specify tolerance, handling of reports beyond it and recovery behavior so a
      bad device clock cannot leave current state or health stuck.
- [x] Recover the realtime frontend after an invalid `room.snapshot`. Preserve
      the last valid snapshot, expose the contract error and reconnect or provide a
      visible retry path; cover invalid-message recovery with a test.
- [x] Update stale implementation-status documentation in package README files,
      architecture guidance and trade-off notes so they accurately describe the
      completed Stage 2/2.5 realtime temperature slice.
- [ ] Make page heading hierarchy scale beyond one device card: keep a single
      page-level `h1` and use lower-level headings in reusable device cards.
- [ ] Select and add a consistent icon set for the UI. Define its usage for
      device status, control actions and feedback states, keeping the choice
      compatible with the frontend's visual language and accessibility needs.
