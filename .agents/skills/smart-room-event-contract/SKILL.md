---
name: smart-room-event-contract
description: Design or verify Smart Room event and command contracts, lifecycle, confirmations or state derivation. Use for changes to those semantics, not unrelated code or documentation edits.
---

# Smart Room Event Contract

Identify the affected event, command, projection, simulator or UI boundary.
Read `docs/architecture/events-and-commands.md` for contract shape and validation;
follow the relevant control-loop, devices and reliability-and-testing sections
for lifecycle, availability and timing.

For command behavior, read the command-correlation/concurrency and
device-confirmation/health ADRs. Read the MQTT source-parity ADR when the boundary
includes MQTT traffic, simulator scenarios or source availability.

Summarize the binding contract before changing or reviewing it. Check shape,
lifecycle, timing, validation and confirmation semantics against those sources,
then inspect tests/scenarios for the affected contract edges. If behavior is
ambiguous, surface the documentation or human decision needed before treating
new behavior as durable.
