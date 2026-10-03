# General Review

Inspect relevant tests and changed/nearby code for concrete correctness,
testability, boundary or maintenance risks. Compare test intent to documented
behavior and realistic failure modes.

Synthesize evidence, resolve duplicate findings and lead with findings ordered by
severity. Cite files/lines and explain practical impact. Useful classifications:
code/doc/structure/contract/projection drift, test gap, weak/redundant test,
decision gap, AI-config drift and AI artifact. Include material assumptions,
uncertainty and suggested actions when findings exist.

## Criteria

- Report implementation, tests or examples that disagree with binding docs.
- Report missing tests when the behavior is documented or user-visible.
- Report weak tests when assertions do not protect meaningful behavior.
- Report redundant tests when they repeat a covered case without reducing
  risk.
- Report decision gaps when behavior appears durable but has not been promoted
  to architecture docs or an ADR.
- Report AI artifacts only when supported by concrete evidence and a meaningful
  risk. Inspect for debug logging, dead commented code, stale placeholders or
  stubs, unused generated files, and comments that contradict the code.
- Also inspect for generated-code patterns such as redundant abstractions,
  artificial indirection, needless duplication or inconsistent local patterns
  when they make correctness, testing, module boundaries or maintenance worse.
- Do not report a TODO, FIXME, placeholder marker or stylistic preference by
  itself; explain the concrete risk and classify substantiated findings as
  `AI artifact`.
- Do not treat planning-only ideas as drift.
- Do not turn a review into implementation planning unless the user asks.
