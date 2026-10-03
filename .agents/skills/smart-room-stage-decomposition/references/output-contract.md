# Output Contract

Preserve the documented Stage token in stable identifiers, including an
intermediate token such as `4.5`. Use `DS-<stage>-<NN>` for Dev Stories and
`ST-<stage>-<story-NN>-<NN>` for Subtasks. Reference dependencies only by these
identifiers.

Begin with:

### Stage `<identifier>` — `<name>`

- **Expected outcome:** the roadmap-level result.
- **Sources reviewed:** binding and planning sources used.
- **Assumptions:** assumptions that do not redefine binding behavior, or
  `none`.
- **Open decisions:** human-owned decisions, or `none`.

For every Dev Story return, including its completion marker in the heading:

### [ ] `<DS identifier>` — `<title>`

- **Value:** the independently useful increment.
- **Observable outcome:** what can be demonstrated when complete.
- **Sources:** supporting architecture, ADR, roadmap or human decision.
- **Affected boundaries:** the ownership or runtime boundaries involved.
- **Depends on:** work-item identifiers or `none`.
- **Difficulty:** `A | B | C | D | E | F`.
- **Difficulty rationale:** concise evidence across the rating
  dimensions.
- **Acceptance criteria:** observable story-level outcomes.
- **Non-goals:** excluded behavior or `none`.
- **Story verification:** the narrowest credible end-to-end or integration
  evidence.

Then list every Subtask under its parent story, including its independent
completion marker in the heading:

#### [ ] `<ST identifier>` — `<title>`

- **Parent story:** Dev Story identifier.
- **Purpose:** the concrete technical outcome.
- **Primary boundary:** the main ownership boundary.
- **Depends on:** work-item identifiers or `none`.
- **Difficulty:** `A | B | C | D | E | F`.
- **Difficulty rationale:** concise engineering-risk evidence.
- **Verification:** the narrowest credible check or test layer.
- **Done when:** an observable stopping condition.

When adapting an existing compact backlog that uses a table for Subtasks, put
the marker in the identifier cell, for example `[ ] ST-4-01-01`, rather than
dropping the per-Subtask completion state.

After all stories include:

- **Recommended order:** dependency-respecting sequence.
- **Technical parallel candidates:** independent stories or Subtasks, or
  `none`; this is not approval to start them.
- **Critical path:** the work items controlling Stage completion.
- **Cost hotspots:** items expected to consume disproportionate reasoning or
  verification effort.
- **Decomposition warnings:** overly broad, ambiguous or decision-dependent
  items, or `none`.
- **Human decisions required:** unresolved developer or architecture choices,
  or `none`.
