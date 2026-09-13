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
4. Hooks provide deterministic lifecycle feedback or enforcement for workflows.
   They do not define Smart Room system behavior.
5. Subagents provide focused research, validation or explicitly bounded
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

## Delivery Work Hierarchy

AI-assisted delivery uses three planning levels:

- a **Stage** is a roadmap-level outcome and is too broad to implement as one
  Goal;
- a **Dev Story** is an independently demonstrable and testable increment of
  user, operator, developer or reliability value;
- a **Subtask** is one technical unit of work required to complete a Dev Story
  and need not provide independent value.

Stage decomposition is separate from detailed planning and implementation. It
produces Dev Stories and Subtasks with their own complexity and phase profiles,
but the developer chooses which work item enters the next workflow. The chosen
unit may be a whole Dev Story or one Subtask.

When a Dev Story is selected, its Subtasks become internal steps of that
execution unit. When a Subtask is selected, the execution scope is limited to
that Subtask and its parent Dev Story remains incomplete. A Dev Story is
complete only when all of its Subtasks are complete and its story-level
acceptance criteria have been verified.

Separate Subtasks may become separate Goals or run in parallel only after the
developer chooses that execution shape and confirms that their dependencies
and checkouts are independent. A decomposition may identify parallel
candidates, but it does not approve or start parallel work.

## Operational Delivery Workflow

This workflow is a preferred operating heuristic for AI-assisted work in this
repository. For each task, recommend choosing the model and reasoning effort
that are optimal for that task and its verification needs. Model availability
and capabilities change, so this document intentionally does not prescribe
model names, fixed profiles or stage-specific defaults.

The `A`–`F` difficulty rating assigned during decomposition can help with that
choice: `A` is the most difficult and `F` is banal. As the task becomes more
difficult (closer to `A`), a stronger model and/or more reasoning effort is
generally appropriate. This is a heuristic, not an automatic router or a
guarantee; the developer decides based on the actual scope, boundaries,
uncertainty, verification breadth, current model capabilities and practical
cost or speed constraints.

Human ownership remains explicit throughout this workflow: the human approves
implementation plans, owns changes to system behavior and architecture,
accepts review outcomes, and decides when to commit or close a Stage.

## Goal-Oriented Task Delivery

Use a Goal for a cohesive selected work item that has stable acceptance
criteria, meaningful verification and a clear stopping condition. The selected
work item may be a Dev Story or a Subtask. Small, local changes should use the
same discipline with a minimal outline instead of Goal ceremony. A roadmap
Stage or an open-ended architecture exploration is too broad to become one
implementation Goal.

The preferred task flow is:

1. inspect binding documentation and repository evidence,
2. prepare a plan with stable acceptance criteria, definition-of-done items,
   non-goals and verification scenarios,
3. obtain human approval for choices that affect behavior or architecture,
4. implement through one writer in one checkout, optionally using read-only
   research subagents,
5. run the narrowest credible verification,
6. pass an independent delivery review,
7. prepare a commit only when explicitly requested.

When a Goal is appropriate, the plan should include a Goal Execution Contract:
the objective, required acceptance criteria and definition-of-done items,
constraints, non-goals, verification, checkpoints, pause conditions and stop
condition. The contract is a handoff of approved requirements; it must not add
new behavior.

One implementation Goal uses one checkout: Local or one worktree. It has one
repository-writing agent. Do not split its acceptance criteria among concurrent
writers. Separate, independently approved Goals, including developer-selected
Subtasks, may run in separate worktrees with separate writers only when their
dependencies, scopes and verification are independent. Completing one Subtask
Goal does not complete its parent Dev Story.

Worktrees isolate parallel chats and their working files; they do not replace
the Goal Execution Contract, the one-writer rule or the delivery gate. Each
worktree must have the dependencies and local setup required for its own
verification. Do not add ignored local files to a worktree automatically; make
that an explicit human-owned decision when it becomes necessary.

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
- hooks remain deterministic workflow feedback rather than a source of system
  behavior, and
- redundant context is reduced when it creates drift risk.

## Updating AI Context

When changing AI-facing project context:

1. Put durable behavior rules in architecture docs or accepted ADRs.
2. Keep `AGENTS.md` files focused on local operating guidance and links.
3. Keep skills focused on reusable workflows.
4. Keep hooks focused on deterministic lifecycle feedback or enforcement, with
   checks mapped to existing repository verification commands.
5. Use subagents to review for drift, redundancy and missing source-of-truth
   links.

If the hierarchy itself changes, update this document first and then align the
affected `AGENTS.md` files, skills or subagent prompts.
