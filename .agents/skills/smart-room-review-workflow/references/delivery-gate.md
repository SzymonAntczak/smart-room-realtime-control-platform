# Delivery Gate

Use the approved plan/Goal contract, stable AC/DoD, Specification Lock, scoped diff
and verification results. Independently inspect cited binding docs, implementation
and tests. Do not infer completion from the implementer's summary.

A blocker must demonstrate a correctness, architecture, contract or required
verification failure against an approved source. Classify it as
`implementation_defect`, `specification_defect`, `requirement_ambiguity`,
`architecture_conflict`, `scope_gap` or `verification_environment`.
Preferences and optional improvements are advisories.

Return:

- `DELIVERY_REVIEW: PASS` with zero blockers, otherwise
  `DELIVERY_REVIEW: BLOCKING`;
- blocking findings first, with affected AC/DoD and source evidence;
- advisories, verification gaps, uncertainty and confidence.

Stay read-only; do not change the plan, specification, AC or DoD. Use the
two-pass stop policy in `docs/architecture/ai-collaboration.md`; the implementer
owns any authorized correction batch, not the reviewer.
