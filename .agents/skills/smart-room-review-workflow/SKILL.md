---
name: smart-room-review-workflow
description: Run a read-only Smart Room review or the independent delivery gate for an approved plan. Use for requested review and delivery acceptance; not implementation or planning.
---

# Smart Room Review Workflow

Stay read-only. Judge behavior against relevant architecture and accepted ADRs;
planning ideas alone are not binding. Inspect the affected implementation, tests
and ownership boundary rather than relying only on a summary.

## Select One Mode

- For a general review, read [general-review.md](references/general-review.md).
  The main agent owns scope, severity and synthesis.
- For an approved-plan delivery gate, read
  [delivery-gate.md](references/delivery-gate.md). The configured
  `smart_room_delivery_reviewer` independently returns the gate verdict.

Delegate at most three independent read-only evidence passes when they materially
improve confidence; skip small, clear or dependent work. Give each one bounded
question and ask for binding sources, observations with references, risks/gaps
and confidence. Researchers do not issue the final review, plan or delivery verdict.

Only the dedicated reviewer may issue a bounded delivery verdict against approved
inputs. It does not redesign the plan or change specification, AC or DoD.
Preserve the two-pass stop policy in `docs/architecture/ai-collaboration.md`.

Follow the documentation and delivery-output policies in
`docs/README.md` and `docs/architecture/ai-collaboration.md`. Return plans,
review results and AC/DoD evidence in the conversation or PR description; do not
create repository reports or append execution results to architecture or ADRs.
