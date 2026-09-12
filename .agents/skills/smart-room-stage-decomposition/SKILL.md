---
name: smart-room-stage-decomposition
description: Use when decomposing a Smart Room roadmap Stage or broad milestone into independently testable Dev Stories and rated Subtasks with dependencies and verification boundaries. Do not use for detailed planning or implementation of a selected work item.
---

# Smart Room Stage Decomposition

Turn one roadmap Stage or broad milestone into a read-only, backlog-ready
proposal of Dev Stories and Subtasks. Decomposition describes the available
work; the developer decides whether a whole Dev Story or one Subtask enters a
later planning or implementation workflow.

## Sources And Boundaries

Start with:

- `README.md` and `docs/README.md`;
- `docs/planning/roadmap.md` and `docs/planning/backlog.md`;
- `docs/architecture/ai-collaboration.md`;
- applicable root and package `AGENTS.md` files;
- applicable architecture documents and accepted ADRs.

Treat architecture documents and accepted ADRs as binding system behavior.
Treat roadmap and backlog content as planning context. Separate confirmed
behavior from planning assumptions and unresolved human decisions. Do not
promote a planning assumption into binding behavior during decomposition.

Return the proposal in the response. Do not edit the backlog or any other file
unless the user explicitly requests that write in addition to decomposition.
Do not create a Goal, start planning or implementation, select a work item for
the developer, or delegate implementation.

## Decomposition Workflow

1. Identify the Stage identifier, intended outcome, completion statement and
   relevant current backlog state.
2. Inspect binding sources and existing implementation evidence needed to
   distinguish established behavior from open decisions.
3. Identify prerequisite gates and unresolved decisions before assigning a
   difficulty rating. When a missing decision directly defines a work item's
   scope, behavior or boundary, state that implementation is blocked pending
   the human decision. Do not hide a material decision gap only in the
   Stage-level open decisions or decomposition warnings.
4. Define Dev Stories around independently demonstrable and testable value, not
   around technical layers. Value may be user, operator, developer or
   reliability value, but it must be observable at a credible boundary.
5. Give each Dev Story explicit acceptance criteria and non-goals. Do not use a
   database table, contract file, endpoint or UI component by itself as a Dev
   Story unless it provides an independently verifiable capability.
6. Split every Dev Story into the complete set of technical Subtasks needed to
   satisfy its acceptance criteria. Prefer one primary responsibility and one
   main ownership boundary per Subtask.
7. Add a distinct integration or acceptance-verification Subtask when the local
   Subtasks do not by themselves prove the story-level outcome.
8. Record dependencies within and between stories using stable identifiers.
   Identify technical parallel candidates without approving or starting
   parallel work.
9. Rate every Dev Story and every Subtask independently. Give each one exactly
   one difficulty rating and a concise rationale.
10. Report unresolved decisions, decomposition warnings and work that must be
    split or decided before implementation.

A Dev Story is complete only when all of its Subtasks are complete and its
story-level acceptance criteria have been verified. Completing one Subtask does
not complete its parent story.

## Difficulty Rating

Rate each work item from `A` through `F`, where `A` is the most difficult and
`F` is banal. Use reasoning difficulty and engineering risk rather than file
count, estimated lines or business importance. Evaluate:

1. architecture novelty;
2. number and importance of system boundaries;
3. contract and semantic risk;
4. lifecycle, time, ordering, concurrency and recovery sensitivity;
5. requirement certainty;
6. verification breadth;
7. blast radius.

### A — Exceptional Or Decision-Blocked

Use for exceptional architecture synthesis, highly coupled reliability work, or
an item whose direct material decision is unresolved. State the blocking human
decision; do not recommend implementation before it is resolved.

### B — High-Risk Or Cross-Boundary

Use when correctness depends on shared contracts, important boundaries,
reliability semantics, lifecycle, time, concurrency, recovery or several
interacting verification layers.

### C — Complex Standard Work

Use for a normal feature in established architecture with several clear
implementation choices and focused verification.

### D — Moderate Bounded Work

Use for established behavior across a small number of clear boundaries with
limited semantic or verification risk.

### E — Small Local Work

Use for a narrow, deterministic change with one primary boundary and a focused
check.

### F — Banal

Use for a mechanical, self-evident edit with negligible blast radius and a
straightforward stopping condition.

Rate a Dev Story separately from its Subtasks. Consider the hardest work on the
critical path, integration risk, story-level acceptance verification and
unresolved dependencies. Do not average Subtask ratings mechanically; several
`C` Subtasks may form an `A` or `B` story when their integration creates
system-level risk.

## Output Contract

Preserve the documented Stage token in stable identifiers, including an
intermediate token such as `4.5`. Use `DS-<stage>-<NN>` for Dev Stories and
`ST-<stage>-<story-NN>-<NN>` for Subtasks. Reference dependencies only by these
identifiers.

Begin with:

### Stage `<identifier>` — `<name>`

- **Expected outcome:** the roadmap-level result.
- **Sources reviewed:** binding and planning sources used.
- **Assumptions:** assumptions that do not redefine binding behavior, or
  `none`.
- **Open decisions:** human-owned decisions, or `none`.

For every Dev Story return:

### `<DS identifier>` — `<title>`

- **Value:** the independently useful increment.
- **Observable outcome:** what can be demonstrated when complete.
- **Sources:** supporting architecture, ADR, roadmap or human decision.
- **Affected boundaries:** the ownership or runtime boundaries involved.
- **Depends on:** work-item identifiers or `none`.
- **Difficulty:** `A | B | C | D | E | F`.
- **Difficulty rationale:** concise evidence across the rating
  dimensions.
- **Acceptance criteria:** observable story-level outcomes.
- **Non-goals:** excluded behavior or `none`.
- **Story verification:** the narrowest credible end-to-end or integration
  evidence.

Then list every Subtask under its parent story:

#### `<ST identifier>` — `<title>`

- **Parent story:** Dev Story identifier.
- **Purpose:** the concrete technical outcome.
- **Primary boundary:** the main ownership boundary.
- **Depends on:** work-item identifiers or `none`.
- **Difficulty:** `A | B | C | D | E | F`.
- **Difficulty rationale:** concise engineering-risk evidence.
- **Verification:** the narrowest credible check or test layer.
- **Done when:** an observable stopping condition.

After all stories include:

- **Recommended order:** dependency-respecting sequence.
- **Technical parallel candidates:** independent stories or Subtasks, or
  `none`; this is not approval to start them.
- **Critical path:** the work items controlling Stage completion.
- **Cost hotspots:** items expected to consume disproportionate reasoning or
  verification effort.
- **Decomposition warnings:** overly broad, ambiguous or decision-dependent
  items, or `none`.
- **Human decisions required:** unresolved developer or architecture choices,
  or `none`.
