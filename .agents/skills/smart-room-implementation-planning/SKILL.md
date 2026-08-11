---
name: smart-room-implementation-planning
description: Use for interactive, evidence-based planning of Smart Room implementation changes. Trigger when the user asks to plan a feature, fix, refactor, or architecture-aligned behavior change before implementation.
---

# Smart Room Implementation Planning

Plan Smart Room changes with the user in the main Plan mode. Do not modify
files while planning.

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
6. When a read-heavy exploration, architecture review or test/reliability review
   would materially improve confidence, explain the proposed subagent role and
   its expected value, then ask the user for permission before delegating. Do
   not delegate automatically.
7. Derive independently verifiable acceptance criteria from binding behavior and
   the requested outcome. Give every criterion a stable ID and cite its source.
8. Turn each criterion into concise scenario statements using the
   Given / When / Then structure in the language of the plan. Use the literal
   English labels only in English plans; for example, write Polish scenarios
   as `Zakładając / gdy / wtedy`. Choose the lowest appropriate layer:
   contract, unit/state model, adapter, BFF, runtime integration or frontend UI.
9. Return an implementation-ready plan with this structure:
    1. Goal and scope
    2. Confirmed behavior and constraints
    3. Files and symbols to change
    4. Ordered implementation steps
    5. Acceptance criteria
    6. Test scenarios and verification
    7. Risks, assumptions and human decisions
    8. Evidence reviewed

## Output conventions

- Acceptance criterion: `AC-N: <observable outcome> — Source: <path and
section, or human decision>.`
- Test scenario: write the scenario's structure in the plan language. For an
  English plan: `AC-N / Scenario N: Given <precondition>, when <action>, then
<observable result>. Layer: <test layer>. Protects: <risk or behavior>.`;
  for a Polish plan: `AC-N / Scenariusz N: Zakładając <warunek wstępny>, gdy
<akcja>, wtedy <obserwowalny rezultat>. Warstwa: <warstwa testowa>.
Chroni przed: <ryzyko lub zachowanie>.`
- Explain why every proposed file change is needed. Cite paths and symbols, and
  include line references when they materially remove ambiguity.
- If the task is too small to justify a full planning pass, say so and provide
  the minimal safe implementation outline.
