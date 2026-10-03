---
name: smart-room-implementation-planning
description: Prepare an evidence-based plan for a selected Smart Room change, with acceptance criteria, verification and an implementation handoff. Use for planning, not Stage decomposition or execution.
---

# Smart Room Implementation Planning

Plan with the user in the main Plan mode; do not modify files.
Inspect the applicable instructions, architecture, accepted ADRs and nearby
implementation/tests. Treat planning docs as direction, not binding behavior.

## Establish The Contract

- Separate confirmed facts, assumptions and human-owned decisions. Resolve
  discoverable facts through inspection; ask a focused question for material
  ambiguity or a choice not established by approved sources.
- Derive stable acceptance criteria with cited sources; do not invent behavior.
  Map each to a concise Given/When/Then scenario in the plan's language and the
  lowest credible test layer. In Polish use `Zakładając / gdy / wtedy`.
- Define stable DoD items, scope/non-goals, verification, dependencies and stop
  conditions. Use [output-contract.md](references/output-contract.md) for the
  handoff's required content, scaled to the task.
- For a cohesive selected item with stable criteria and credible verification,
  read [goal-execution-contract.md](references/goal-execution-contract.md) and
  include the contract. A whole roadmap Stage or open-ended exploration is too
  broad for one Goal; use a minimal outline for small local work.

When independent read-heavy evidence would materially improve confidence,
delegate at most two read-only passes. Give each one question, a boundary and
expected sources/observations/risks/uncertainty/confidence. Do not delegate user
decisions, plan synthesis, dependent work or small clear tasks. The main agent
owns the final plan. Delegation does not authorize implementation.
