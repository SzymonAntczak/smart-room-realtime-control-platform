# AI Collaboration Model

This document defines how AI-facing project context is organized in this
repository. The goal is to keep one clear source of truth and avoid repeating
the same behavior rules across documentation, `AGENTS.md` files, skills and
subagent prompts.

## Source-Of-Truth Hierarchy

1. `docs/architecture/` and accepted ADRs in `docs/decisions/` define binding
   system behavior.
2. `AGENTS.md` files provide local operating instructions for AI agents working
   in a repository area.
3. Skills provide reusable workflows for common kinds of work.
4. Subagents provide focused research, validation or explicitly bounded
   delivery judgment.

Planning documents in `docs/planning/` remain directional context until an idea
is promoted into architecture docs or an accepted ADR.

## Documentation

Architecture docs and accepted ADRs are the source of truth for system behavior:
event contracts, command lifecycle, device state, reliability rules, simulator
boundaries, frontend behavior and backend responsibilities.

When behavior changes, update the relevant architecture document or ADR first.
Other AI-facing files should point back to those sources instead of becoming a
parallel contract.

## AGENTS.md Files

`AGENTS.md` files should explain how AI agents should work in a specific scope.
They may include:

- the role of the directory,
- the relevant source-of-truth documents to read,
- ownership and boundary reminders,
- verification expectations,
- repository-specific workflow constraints.

They should avoid restating detailed behavior rules from architecture docs or
ADRs. Short guardrails are acceptable when they prevent common mistakes, but the
file should link to the binding document that owns the rule.

If an `AGENTS.md` file conflicts with architecture docs or accepted ADRs, treat
that as AI-configuration drift and update the `AGENTS.md` file.

## Skills

Skills should describe workflows, not define durable system rules.

They may include:

- when to use the workflow,
- which source files to read,
- the sequence of steps to follow,
- expected output shape for the workflow.

They should not duplicate domain behavior from architecture docs, ADRs or
`AGENTS.md` files. When a skill needs behavior context, it should load or cite
the relevant source document.

## Operational Delivery Workflow

This workflow is a preferred operating heuristic for AI-assisted work in this
repository. It helps choose an appropriate model and reasoning effort for a
delivery stage; it does not define Smart Room system behavior and does not
override the documentation hierarchy above.

The current model guidance is: use Sol for frontier reasoning, Terra when
balancing capability and cost, and Luna for efficient procedural work. Start
with `medium` reasoning when it is appropriate for the task and increase it
only when the extra reasoning produces a meaningful quality gain. Revisit these
presets as model availability and observed project outcomes change; see the
[official OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model).

| Delivery stage                               | Default selection       | Escalation or boundary                                                                                                                                                                               |
| -------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decompose a roadmap Stage into backlog tasks | Sol High                | Use Sol XHigh only when the Stage creates a fundamental system boundary or requires unusually difficult synthesis.                                                                                   |
| Plan one accepted task                       | Sol High                | Use Sol XHigh only when the plan needs exceptional cross-cutting analysis. The human owner approves the plan and resolves material decisions.                                                        |
| Implement an approved plan                   | Terra Medium            | Use the verified implementation workflow and one writer. Escalate only as needed: Terra High, then Sol Medium, then Sol High. The implementer must not silently redesign system behavior.            |
| Review a task                                | Sol High                | Use Sol XHigh only for unusually complex review evidence. General review remains read-only; the delivery reviewer provides an independent bounded gate.                                              |
| Prepare and create a commit                  | Luna Low or Luna Medium | Keep the existing scoped commit workflow; the human owner chooses when the reviewed change is accepted for commit.                                                                                   |
| Audit completion of a whole Stage            | Sol Ultra               | Use only for a read-only audit with separable, independent areas of evidence. It is not the default for a task or normal Stage decomposition. The human owner decides whether the Stage is complete. |

The main agent's model is selected manually for the task. Project configuration
provides compatible subagent defaults and focused research presets; it cannot
automatically switch the main agent's model between delivery stages.

Human ownership remains explicit throughout this workflow: the human approves
implementation plans, owns changes to system behavior and architecture,
accepts review outcomes, and decides when to commit or close a Stage.

## Goal-Oriented Task Delivery

Use a Goal for a cohesive implementation task that has stable acceptance
criteria, meaningful verification and a clear stopping condition. Small, local
changes should use the same discipline with a minimal outline instead of Goal
ceremony. A roadmap Stage or an open-ended architecture exploration is too
broad to become one implementation Goal.

The preferred task flow is:

1. inspect binding documentation and repository evidence,
2. prepare a plan with stable acceptance criteria, definition-of-done items,
   non-goals and verification scenarios,
3. obtain human approval for choices that affect behavior or architecture,
4. implement through one writer, optionally using read-only research
   subagents,
5. run the narrowest credible verification,
6. pass an independent delivery review,
7. prepare a commit only when explicitly requested.

When a Goal is appropriate, the plan should include a Goal Execution Contract:
the objective, required acceptance criteria and definition-of-done items,
constraints, non-goals, verification, checkpoints, pause conditions and stop
condition. The contract is a handoff of approved requirements; it must not add
new behavior.

Specification evidence may be locked selectively when it directly represents
an approved acceptance criterion. Locked evidence is not rewritten merely to
make an implementation pass. This does not freeze unrelated tests or prevent a
human-approved correction to a defective specification.

Delivery review is bounded to two passes. After the first `BLOCKING` result,
the implementation workflow may apply one cohesive correction batch only for
confirmed implementation defects, then rerun verification and request one
final review. Specification defects, requirement ambiguity, architecture
conflicts, scope gaps and verification-environment failures stop autonomous
remediation immediately. A second `BLOCKING` result also stops the workflow and
returns a decision package to the human.

Use these blocker categories consistently:

- `implementation_defect` — code or tests fail an approved requirement,
- `specification_defect` — approved specification evidence is internally wrong,
- `requirement_ambiguity` — the intended behavior cannot be resolved from
  approved sources,
- `architecture_conflict` — the requested outcome conflicts with binding
  architecture or an accepted ADR,
- `scope_gap` — completion requires work outside the approved scope,
- `verification_environment` — required verification cannot run credibly in the
  available environment.

## Subagents

Subagents should be used primarily for focused, independent exploration,
review, validation and checks. Skills own reusable workflows and decide whether
a focused pass is needed; the main agent owns user interaction, planning
decisions, implementation synthesis and the final general-review response. A
dedicated delivery reviewer is the narrow exception: it may issue a bounded
`PASS` or `BLOCKING` judgment against an approved plan, acceptance criteria and
definition of done.

Review and planning skills may automatically delegate independent, read-heavy
passes when they materially improve confidence. Use at most three passes for a
review and two for a plan. Do not delegate a small, clear task, dependent work,
or overlapping write work merely because it is difficult.

Research subagents should:

- stay read-only unless explicitly assigned implementation work,
- identify the binding source of truth before judging a change,
- report drift, redundancy and missing documentation,
- cite files and lines when possible,
- return concise evidence, risk and confidence rather than a competing final
  review or implementation plan,
- avoid introducing new behavior rules in their output.

The delivery reviewer instead reports the gate result, blocking findings,
advisories, affected acceptance criteria or definition-of-done items and any
remaining uncertainty. It remains read-only and must not redesign the plan or
change the specification.

For AI-configuration reviews, subagents should check that:

- docs remain the source of truth for behavior,
- `AGENTS.md` files point to docs instead of duplicating them,
- skills remain workflow-oriented,
- subagent roles and prompts remain narrowly scoped to research, review
  evidence or validation, except for explicitly bounded delivery judgment or
  explicitly assigned implementation,
- redundant context is reduced when it creates drift risk.

## Updating AI Context

When changing AI-facing project context:

1. Put durable behavior rules in architecture docs or accepted ADRs.
2. Keep `AGENTS.md` files focused on local operating guidance and links.
3. Keep skills focused on reusable workflows.
4. Use subagents to review for drift, redundancy and missing source-of-truth
   links.

If the hierarchy itself changes, update this document first and then align the
affected `AGENTS.md` files, skills or subagent prompts.
