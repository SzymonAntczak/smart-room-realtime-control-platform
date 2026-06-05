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
- [Stage 1 Local Runtime and Repository Boundaries](adr-stage-1-local-runtime-and-repository-boundaries.md)
- [Device Command Confirmation and Health Policy](adr-device-command-confirmation-and-health-policy.md)
- [Command Correlation, Confirmation and Concurrency](adr-command-correlation-confirmation-and-concurrency.md)
