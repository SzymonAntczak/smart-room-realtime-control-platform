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
4. Subagents provide focused review or validation passes.

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

## Subagents

Subagents should be used primarily for focused, independent exploration,
review, validation and checks. Skills own reusable workflows and decide whether
a focused pass is needed; the main agent owns user interaction, synthesis and
the final review or implementation plan.

Review and planning skills may automatically delegate independent, read-heavy
passes when they materially improve confidence. Use at most three passes for a
review and two for a plan. Do not delegate a small, clear task, dependent work,
or overlapping write work merely because it is difficult.

Subagents should:

- stay read-only unless explicitly assigned implementation work,
- identify the binding source of truth before judging a change,
- report drift, redundancy and missing documentation,
- cite files and lines when possible,
- return concise evidence, risk and confidence rather than a competing final
  review or implementation plan,
- avoid introducing new behavior rules in their output.

For AI-configuration reviews, subagents should check that:

- docs remain the source of truth for behavior,
- `AGENTS.md` files point to docs instead of duplicating them,
- skills remain workflow-oriented,
- subagent roles and prompts remain narrowly scoped to research, review
  evidence or validation unless explicitly assigned implementation,
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
