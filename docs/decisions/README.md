# Decisions

This directory stores durable decisions and trade-offs.

Use this directory when the document answers "why did we choose this?" rather than "how does the system work today?"

Good candidates:

- boundaries that are expensive to change
- trade-offs between competing options
- decisions that future contributors may question
- constraints that explain the current architecture

Keep current system behavior in [architecture](../architecture/). Promote a trade-off into a dedicated ADR when it becomes stable, controversial or expensive to reverse.

## Accepted ADRs

- [Local-First Before Cloud](adr-local-first-before-cloud.md)
- [Event Simulator Before Real Devices](adr-event-simulator-before-real-devices.md)
- [Device Command Confirmation and Health Policy](adr-device-command-confirmation-and-health-policy.md)
- [Command Correlation, Confirmation and Concurrency](adr-command-correlation-confirmation-and-concurrency.md)
- [JSON Schema Transport Contracts](adr-json-schema-transport-contracts.md)
- [Command History and Terminal Projections](adr-command-history-and-terminal-projections.md)
- [Room Realtime Synchronization](adr-room-realtime-synchronization.md)
- [Server-Sent Events for the Realtime BFF](adr-server-sent-events-realtime-bff.md)
- [LED Command Transport and Operational Defaults](adr-led-command-transport-and-operational-defaults.md)
- [External Actuation and Command Outcomes](adr-external-actuation-and-command-outcomes.md)
- [Device Availability, Health and Observation Freshness](adr-device-availability-and-observation-freshness.md)
- [MQTT Source Parity Before Device Expansion](adr-mqtt-source-parity-before-device-expansion.md)
- [Playwright for Frontend Integration Tests](adr-playwright-frontend-integration-tests.md)
- [Stage 4 Storage and Observability](adr-stage-4-storage-and-observability.md)

## Superseded ADRs

- [Versioned Room Realtime Synchronization](adr-versioned-room-realtime-sync.md)
