---
name: smart-room-verified-implementation
description: Implement an approved Smart Room change with acceptance evidence and an independent bounded delivery gate. Use a minimal contract for small changes; not for unapproved architecture decisions.
---

# Smart Room Verified Implementation

Load the approved plan/Goal contract, preserving stable AC and DoD identifiers.
Read applicable instructions and binding sources, inspect the worktree and
preserve unrelated changes. Derive missing minimum criteria only from approved
sources; unresolved behavior or architecture requires a human decision.

## Execute

- Keep one accountable writer in one checkout per execution unit. Research agents
  stay read-only; do not split one Goal's criteria among concurrent writers.
  Independent approved Goals require independent scopes, dependencies and checkouts.
- Map criteria to verification. Lock only explicitly identified acceptance evidence
  as the Specification Lock; do not rewrite it to force a pass. Unrelated tests
  are not locked. Docs/config refactors need no synthetic red phase.
- Implement the smallest cohesive approved change. At checkpoints run the narrowest
  credible checks; report what establishes each criterion.
- Continue authorized reversible work without repeated approval. Do not change
  architecture, specification or scope, or commit without explicit authorization.

## Delivery Gate

Use the configured `smart_room_delivery_reviewer`, not a general review pass.
Supply the approved plan/contract, AC, DoD, Specification Lock, scoped diff and
verification results. It independently returns `DELIVERY_REVIEW: PASS` or
`DELIVERY_REVIEW: BLOCKING`.

Read the Goal-Oriented Task Delivery policy in
`docs/architecture/ai-collaboration.md` when handling the gate. After first
BLOCKING, classify every blocker. Apply at most one cohesive correction batch
only for confirmed `implementation_defect` blockers within scope, rerun affected
checks and request one final review. Stop immediately for
`specification_defect`, `requirement_ambiguity`, `architecture_conflict`,
`scope_gap` or `verification_environment`. A second BLOCKING also stops work.

Return the decision package for a stop: classification, affected AC/DoD, source
evidence, completed verification and one recommended next workflow. Advisories
are not blockers unless the approved contract requires them.

Report AC/DoD status, files, checks, gate result/advisories and remaining decisions.
If a Goal is active, complete it only after every required criterion and DoD
passes and delivery review returns PASS.
