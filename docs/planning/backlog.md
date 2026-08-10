# Implementation Follow-ups

This list records deliberately deferred implementation work. It does not define
binding system behavior; promote a durable rule to architecture documentation or
an ADR as part of the related change.

## Open Follow-ups

- [x] Add frontend internationalization with `react-i18next`. Establish the
      translation-provider bootstrap, locale detection and a maintainable
      namespace structure; migrate user-visible dashboard and development-panel
      strings without translating stable machine-readable reasons, event names
      or API values. Define an initial supported locale set and a fallback
      locale before exposing a language selector.
      Done when: the frontend has deterministic fallback behavior, representative
      dashboard and development-control flows render from translation resources,
      and focused tests cover locale selection and fallback rendering.

- [x] Migrate the server-to-client realtime BFF stream from WebSocket to SSE.
      First record and accept an ADR that confirms SSE is the intended durable
      transport. Preserve the room snapshot baseline, revision-linked updates,
      boundary validation and visible reconnect behavior; keep all frontend
      command requests on explicit HTTP boundaries.
      Done when: the BFF, shared transport contracts, frontend realtime client,
      architecture documentation and focused reconnect/contract tests use SSE,
      and no application command ingress is accepted through the realtime
      stream.

- [ ] Implement physical LED actuation according to the external-actuation ADR
      before Stage 6 hardware acceptance. A physical state report must update
      observed state even during a Dashboard command; a matching report confirms
      the requested outcome without asserting causal attribution, while a
      non-matching report leaves the command pending.
      Done when: simulator or hardware-adapter tests and UI tests cover physical
      actuation with no active command, matching and non-matching active
      commands, and a matching report after timeout.
