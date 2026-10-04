---
name: smart-room-stage-decomposition
description: Decompose a Smart Room roadmap Stage into testable Dev Stories and rated Subtasks. Use before selecting work; not for detailed planning or implementation of a selected item.
---

# Smart Room Stage Decomposition

Return a read-only backlog-ready proposal. The developer chooses whether a whole
Dev Story or one Subtask enters planning or implementation.

Read the relevant roadmap/backlog, architecture, accepted ADRs and
`docs/architecture/ai-collaboration.md`. Separate established behavior, planning
assumptions and human decisions. Do not edit files unless that write is explicitly
requested; do not create a Goal, select work or start implementation.

## Decompose

- Identify the Stage token, outcome, completion statement and existing backlog.
- Expose prerequisite gates and decisions before rating work. A material decision
  defining an item's scope or boundary blocks that item; report it on the item.
- Define stories by independently demonstrable user, operator, developer or
  reliability value. Give each acceptance criteria and non-goals; a technical
  layer alone does not establish story value. A story may span several ownership
  or runtime boundaries when they jointly deliver one coherent result. Split
  stories when they contain independently useful outcomes.
- Split each story into all required subtasks with one primary responsibility,
  boundary and focused verification. Do not bundle contract, persistence/runtime,
  BFF and Dashboard changes into one subtask. Add an integration/acceptance
  subtask when local evidence cannot establish the story outcome.
- End every new story with a distinct whole-story review Subtask depending on
  all preceding Subtasks. Rate it independently and verify all story criteria,
  integration, documentation and verification through the independent delivery
  gate. Integration tests or individual Subtask reviews do not replace it.
- Record dependencies and technical parallel candidates without approving work.
  Integration composes completed pieces without expanding their behavior.
- Rate stories and subtasks independently using
  [difficulty-rating.md](references/difficulty-rating.md); report uncertainty,
  oversized work and decisions requiring resolution.
- Produce the proposal using [output-contract.md](references/output-contract.md).
  Preserve Stage tokens, dependency IDs and independent completion markers.
  A story is complete only when all preceding subtasks are complete, its final
  whole-story review returns PASS and the human accepts the outcome. An unfinished
  or BLOCKING review leaves the story open. Preserve the explicitly documented
  historical migration exception; never infer retrospective PASS.
  Use `[ ]` by default; use `[x]` only for completion already recorded in the
  reviewed backlog or explicitly requested by the user. Partial subtasks do not
  establish parent completion.
