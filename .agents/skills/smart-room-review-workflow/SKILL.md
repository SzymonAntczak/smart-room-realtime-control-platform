---
name: smart-room-review-workflow
description: Use for read-only Smart Room reviews, including architecture conformance, frontend conformance, control reliability, AI configuration, test gaps, documentation drift, decision gaps, and reusable review output structure.
---

# Smart Room Review Workflow

Use this skill to lead Smart Room reviews consistently. The main agent owns the
scope, finding severity and final report; subagents supply only focused,
read-only evidence when useful.

## Workflow

1. Stay read-only. Do not edit files.
2. Identify the binding source of truth before judging implementation.
3. Treat `docs/architecture` and accepted ADRs as binding for system behavior.
4. Treat `docs/planning` as directional context unless promoted to architecture
   or an accepted ADR.
5. Decide whether independent read-heavy evidence would materially improve
   confidence. Delegate at most three read-only passes; skip delegation for a
   small, clear review or dependent work.
6. Give each pass one distinct question, the relevant boundary and an expected
   evidence summary. Suitable passes include architecture, reliability,
   frontend, simulator and AI-configuration research.
7. Inspect the touched files and nearby ownership boundary.
8. Inspect the relevant tests with the same behavior boundary in mind.
9. Inspect changed and nearby code for AI-generation artifacts that create a
   concrete correctness, testability, boundary or maintenance risk.
10. Compare test intent against documented behavior, changed behavior and
   realistic failure modes.
11. Synthesize delegated evidence, resolve duplicate findings and classify
    findings when useful: code drift, doc drift, structure drift,
    contract drift, projection drift, test gap, weak test, redundant test,
    decision gap, AI-config drift, or AI artifact.
12. Lead with concrete findings ordered by severity.
13. Cite files and lines when possible.
14. Include open questions or assumptions when they affect confidence.
15. End with a short suggested-actions section when there are findings.

## Delegated Evidence

Ask each subagent to return only: binding sources checked, observations with
file references, concrete risks or gaps, and confidence. Do not ask a subagent
to assign final severity, produce the final review or create an implementation
plan.

## Review Boundary

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
