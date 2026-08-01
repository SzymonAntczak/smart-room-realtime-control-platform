# Implementation Follow-ups

This list records small technical follow-ups deliberately deferred during
implementation. It does not repeat the product roadmap or define system
behavior.

- [ ] Introduce Zod schemas at runtime trust boundaries, replacing the
  hand-written frontend guards first. Cover the `room.snapshot` WebSocket
  decoder and the development scenario HTTP client, then reuse platform
  schemas at backend API and adapter inputs where appropriate. Keep schemas out
  of presentational components and simulator-native schemas out of `shared`.
- [ ] Migrate the backend HTTP runtime from the direct Node.js server to
  Fastify. Preserve the existing local BFF responsibilities and
  `room.snapshot` WebSocket contract; choose the WebSocket integration before
  starting the migration.
- [ ] Select and add a consistent icon set for the UI. Define its usage for
  device status, control actions and feedback states, keeping the choice
  compatible with the frontend's visual language and accessibility needs.
