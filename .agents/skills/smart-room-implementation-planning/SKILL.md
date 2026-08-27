---
name: smart-room-implementation-planning
description: Use for interactive, evidence-based planning of Smart Room implementation changes, including Goal-ready handoffs with acceptance criteria and definition of done.
---

# Smart Room Implementation Planning

Plan Smart Room changes with the user in the main Plan mode. Do not modify
files while planning. Make the scope, non-goals and proof of completion explicit.

## Workflow

1. Start with `README.md` and `docs/README.md`. Read the applicable local
   `AGENTS.md` files, binding architecture documents and accepted ADRs before
   proposing behavior changes.
2. Treat `docs/architecture` and accepted ADRs as the source of truth; treat
   `docs/planning` as directional context only.
3. Inspect the relevant implementation, tests and nearby ownership boundaries.
4. Separate confirmed facts from assumptions and human-owned decisions. Do not
   invent requirements, make architectural decisions or silently resolve
   ambiguity.
5. When a material ambiguity affects the plan and can be resolved now, ask the
   user one focused question before completing the plan.
6. When independent, read-heavy exploration would materially improve
   confidence, delegate up to two read-only passes without separate permission.
   Use them for documentation research, execution-path mapping, test evidence
   or established-pattern research; do not delegate user decisions, plan
   synthesis, dependent work or a small clear task.
7. Derive independently verifiable acceptance criteria from binding behavior and
   the requested outcome. Give every criterion a stable ID and cite its source.
8. Turn each criterion into concise scenario statements using the
   Given / When / Then structure in the language of the plan. Use the literal
   English labels only in English plans; for example, write Polish scenarios
   as `Zakładając / gdy / wtedy`. Choose the lowest appropriate layer:
   contract, unit/state model, adapter, BFF, runtime integration or frontend UI.
9. Define stable definition-of-done items such as `DoD-1`, including required
   checks, documentation alignment and delivery-review expectations.
10. Decide whether the task is suitable for Goal-based execution. Prefer a Goal
    for a cohesive task with stable acceptance criteria, credible verification
    and a clear stop condition. Use a minimal execution outline for a small
    local change. Do not turn an open-ended architecture exploration or an
    entire roadmap Stage into one Goal.
11. Return an implementation-ready plan with this structure:
    1. Goal and scope
    2. Confirmed behavior, constraints and non-goals
    3. Files and symbols to change
    4. Ordered implementation steps
    5. Acceptance criteria
    6. Executable scenarios and verification
    7. Definition of done
    8. Goal suitability and Goal Execution Contract when suitable
    9. Risks, assumptions and human decisions
    10. Evidence reviewed

## Goal Execution Contract

For a Goal-suitable task, preserve a durable implementation handoff containing:

- the objective, approved scope and non-goals,
- stable acceptance criteria and their sources,
- stable definition-of-done items,
- scenario identifiers, verification layer and expected outcome,
- constraints and unresolved assumptions that must not be guessed,
- checkpoints and pause conditions,
- an explicit stop condition.

The contract transfers approved requirements to implementation; it must not
invent or broaden them. If a criterion cannot be sourced, leave it as an open
decision instead of placing it in the contract.

## Delegated Evidence

Give each subagent one bounded research question and ask for binding sources,
observed facts with file references, concrete risks or gaps, uncertainties and
confidence. Keep user interaction, architectural decisions and the final plan
in the main thread.

## Output conventions

- Acceptance criterion: `AC-N: <observable outcome> — Source: <path and
section, or human decision>.`
- Definition-of-done item: `DoD-N: <required completion evidence>.`
- Test scenario: write the scenario's structure in the plan language. For an
  English plan: `AC-N / Scenario N: Given <precondition>, when <action>, then
<observable result>. Layer: <test layer>. Protects: <risk or behavior>.`;
  for a Polish plan: `AC-N / Scenariusz N: Zakładając <warunek wstępny>, gdy
<akcja>, wtedy <obserwowalny rezultat>. Warstwa: <warstwa testowa>.
Chroni przed: <ryzyko lub zachowanie>.`
- Explain why every proposed file change is needed. Cite paths and symbols, and
  include line references when they materially remove ambiguity.
- State non-goals so implementation cannot silently expand the approved scope.
- If the task is too small to justify a full planning pass, say so and provide
  the minimal safe implementation outline.
