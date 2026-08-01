---
name: smart-room-architecture-decision
description: Use for Smart Room architecture planning, ADR drafting, trade-off analysis, roadmap alignment, or preparing options for human-owned system behavior decisions. Trigger when work touches docs/architecture, docs/decisions, control-loop design, simulator-before-hardware, local-first architecture, or AI-assisted development boundaries.
---

# Smart Room Architecture Decision

Use this skill to keep architecture work deliberate, documented and aligned with
the project goal.

## Workflow

1. Read the relevant planning and architecture docs before proposing changes.
2. Identify whether the work is a new decision, an update to an existing ADR, or
   a temporary trade-off.
3. Pull behavior rules from the architecture docs and accepted ADRs, not from
   this workflow.
4. Document consequences, not only the chosen option.
5. When a planning idea becomes binding, move it into architecture or an ADR.

## Source Files

Use these files as the main context:

- `docs/planning/goal.md`
- `docs/planning/roadmap.md`
- `docs/architecture/system-overview.md`
- `docs/architecture/system-context.md`
- `docs/architecture/control-loop.md`
- `docs/architecture/devices.md`
- `docs/architecture/events-and-commands.md`
- `docs/architecture/reliability-and-testing.md`
- `docs/architecture/ai-collaboration.md`
- `docs/decisions/adr-template.md`
- `docs/decisions/adr-local-first-before-cloud.md`
- `docs/decisions/adr-event-simulator-before-real-devices.md`
- `docs/decisions/adr-command-correlation-confirmation-and-concurrency.md`
- `docs/decisions/adr-device-command-confirmation-and-health-policy.md`
- `docs/decisions/adr-command-history-and-terminal-projections.md`
- `docs/decisions/adr-json-schema-transport-contracts.md`
- `docs/decisions/tradeoffs.md`

## Decision Output

For ADR-style work, include:

- status
- context
- decision
- consequences
- rejected alternatives when useful
- verification or acceptance criteria

For implementation planning, end with what should be true before the step is
considered complete.
