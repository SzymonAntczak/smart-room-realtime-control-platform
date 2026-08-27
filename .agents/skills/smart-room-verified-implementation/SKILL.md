---
name: smart-room-verified-implementation
description: Use when implementing an approved Smart Room plan or cohesive behavior change that needs explicit acceptance criteria, verification, and a bounded delivery gate. Use the minimal path for small changes.
---

# Smart Room Verified Implementation

Implement an approved Smart Room change through one accountable writer, trace
the result to stable success criteria and finish with an independent delivery
gate. This skill does not authorize architecture changes, specification changes
or commits that the user did not request.

## Establish The Execution Contract

1. Load the approved plan or Goal Execution Contract. Preserve stable
   acceptance-criterion and definition-of-done identifiers.
2. If the task has no explicit criteria, derive the minimum necessary criteria
   only from the user's request, binding architecture and accepted ADRs. Do not
   invent behavior. Stop for a human decision when those sources are ambiguous
   or conflicting.
3. Read the relevant `AGENTS.md` files, architecture documents and ADRs before
   changing behavior.
4. Inspect the worktree and preserve unrelated user changes.
5. Confirm the scope, non-goals, verification scenarios, checkpoints, pause
   conditions and stop condition. Use a compact version for small local work.

## Implement Through One Writer

- Keep one agent responsible for all repository writes in the task. Research
  subagents, when useful, remain read-only and return evidence.
- Identify the tests or other specification evidence that directly maps to each
  acceptance criterion.
- When meaningful for behavior work, add or refine acceptance-level evidence
  before implementation and confirm that it fails for the intended reason.
  Documentation, configuration and mechanical refactors do not require a
  synthetic red phase.
- Treat only explicitly identified acceptance-mapped evidence as the
  Specification Lock. Do not rewrite it merely to make the implementation pass.
  Unrelated tests are not locked.
- Implement the smallest cohesive change that satisfies the approved contract.
- At each checkpoint, run the narrowest credible tests and static checks. Keep
  acceptance criteria, definition-of-done items and verification results
  traceable.
- Do not create a git commit unless the user explicitly asks for one.

## Run The Delivery Gate

Give the configured `smart_room_delivery_reviewer` agent—not a general review
pass—the approved plan or Goal contract, stable acceptance criteria, definition
of done, Specification Lock, relevant diff and verification results. The
reviewer independently inspects repository evidence and returns
`DELIVERY_REVIEW: PASS` or `DELIVERY_REVIEW: BLOCKING`.

If the first review is `BLOCKING`:

1. Classify every blocker as `implementation_defect`, `specification_defect`,
   `requirement_ambiguity`, `architecture_conflict`, `scope_gap` or
   `verification_environment`.
2. Apply at most one cohesive correction batch, and only when every blocker to
   be corrected is a confirmed `implementation_defect` within the approved
   scope.
3. Rerun the affected verification and request one final delivery review.

Stop immediately without autonomous remediation for any other blocker class. A
second `BLOCKING` result also ends autonomous work. Return a decision package
containing the blocker classification, affected acceptance criteria and
definition-of-done items, source evidence, completed verification and one
recommended next workflow.

`PASS` means there are no blocking findings. Record advisories, but do not treat
them as failed delivery unless the approved contract makes them required.

## Completion

Report:

- acceptance criteria and definition-of-done status,
- files changed,
- verification run and its result,
- delivery-review result and advisories,
- residual risks or human decisions.

If a Goal is active, mark it complete only after all required criteria and
definition-of-done items pass and the delivery review returns `PASS`.
