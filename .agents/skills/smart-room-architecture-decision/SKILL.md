---
name: smart-room-architecture-decision
description: Use for Smart Room architecture planning, ADR drafting, trade-off analysis, roadmap alignment, or deciding system behavior. Trigger when work touches docs/architecture, docs/decisions, control-loop design, simulator-before-hardware, local-first architecture, or AI-assisted development boundaries.
---

# Smart Room Architecture Decision

Use this skill to keep architecture work deliberate, documented and aligned with
the project goal.

## Workflow

1. Read the relevant planning and architecture docs before proposing changes.
2. Identify whether the work is a new decision, an update to an existing ADR, or
   a temporary trade-off.
3. Preserve the project direction: local-first, simulator-first, event-driven,
   reliable control UX, minimal hardware early.
4. Separate facts from intent:
   - events are facts
   - commands are requests
   - UI state must not pretend intent is confirmed reality
5. Document consequences, not only the chosen option.

## Source Files

Use these files as the main context:

- `docs/planning/goal.md`
- `docs/planning/roadmap.md`
- `docs/architecture/system-overview.md`
- `docs/architecture/system-context.md`
- `docs/architecture/control-loop.md`
- `docs/architecture/events-and-commands.md`
- `docs/decisions/adr-template.md`
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
