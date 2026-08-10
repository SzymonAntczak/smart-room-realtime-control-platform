# Implementation Follow-ups

This list records deliberately deferred implementation work. It does not define
binding system behavior; promote a durable rule to architecture documentation or
an ADR as part of the related change.

## Open Follow-ups

- [ ] Implement physical LED actuation according to the external-actuation ADR
      before Stage 6 hardware acceptance. A physical state report must update
      observed state even during a Dashboard command; a matching report confirms
      the requested outcome without asserting causal attribution, while a
      non-matching report leaves the command pending.
      Done when: simulator or hardware-adapter tests and UI tests cover physical
      actuation with no active command, matching and non-matching active
      commands, and a matching report after timeout.
