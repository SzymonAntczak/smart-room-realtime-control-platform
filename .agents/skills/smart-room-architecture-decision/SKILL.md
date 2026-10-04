---
name: smart-room-architecture-decision
description: Prepare Smart Room architecture options, trade-offs or ADR decisions for human approval. Use when choosing or changing system behavior; not for editorial fixes or routine implementation of an approved decision.
---

# Smart Room Architecture Decision

Identify whether the work is a new decision, an ADR update or a temporary
trade-off. Read the architecture and accepted ADRs relevant to the affected
behavior; use goal/roadmap for direction and tradeoffs.md for early options.

Pull behavior from binding sources, document consequences and keep human
ownership explicit. Promote a planning idea into architecture or an ADR before
treating it as durable behavior.

Use `docs/decisions/adr-template.md` for ADR work: status, context, decision,
consequences, relevant rejected alternatives and verification/acceptance criteria.
For implementation planning, state what establishes completion.

Load `docs/architecture/ai-collaboration.md` for AI delivery/governance decisions,
control-loop/events/devices/reliability documents for their respective behavior,
and the corresponding accepted ADRs from `docs/decisions/`. Do not load the
entire documentation tree merely because one architecture file is touched.

Follow the documentation and delivery-output policies in
`docs/README.md` and `docs/architecture/ai-collaboration.md`. Return plans,
review results and AC/DoD evidence in the conversation or PR description; do not
create repository reports or append execution results to architecture or ADRs.
