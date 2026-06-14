---
name: smart-room-review-workflow
description: Use for read-only Smart Room reviews, including architecture conformance, frontend conformance, control reliability, AI configuration, test gaps, documentation drift, decision gaps, and reusable reviewer output structure.
---

# Smart Room Review Workflow

Use this skill to keep Smart Room reviews consistent across subagents and manual
review work.

## Workflow

1. Stay read-only. Do not edit files.
2. Identify the binding source of truth before judging implementation.
3. Treat `docs/architecture` and accepted ADRs as binding for system behavior.
4. Treat `docs/planning` as directional context unless promoted to architecture
   or an accepted ADR.
5. Inspect the touched files and nearby ownership boundary.
6. Inspect the relevant tests with the same behavior boundary in mind.
7. Compare test intent against documented behavior, changed behavior and
   realistic failure modes.
8. Classify findings when useful: code drift, doc drift, structure drift,
   contract drift, projection drift, test gap, weak test, redundant test,
   decision gap, or AI-config drift.
9. Lead with concrete findings ordered by severity.
10. Cite files and lines when possible.
11. Include open questions or assumptions when they affect confidence.
12. End with a short suggested-actions section when there are findings.

## Review Boundary

- Report implementation, tests or examples that disagree with binding docs.
- Report missing tests when the behavior is documented or user-visible.
- Report weak tests when assertions do not protect meaningful behavior.
- Report redundant tests when they repeat a covered case without reducing
  risk.
- Report decision gaps when behavior appears durable but has not been promoted
  to architecture docs or an ADR.
- Do not treat planning-only ideas as drift.
- Do not turn a review into implementation planning unless the user asks.
