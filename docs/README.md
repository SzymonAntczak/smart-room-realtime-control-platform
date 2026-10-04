# Smart Room Documentation

This is the documentation entry point for the Smart Room Realtime Control Platform.

The documentation is the source of truth for the project. Architecture
documents describe the agreed target system model. Decision documents
describe durable choices and trade-offs. Planning documents describe direction
and learning goals, but they are not binding system contracts until promoted to
architecture or decisions.

When application behavior disagrees with architecture or accepted decisions,
treat that as drift to resolve in code, tests, documentation or a new decision.

## Documentation Policy

Architecture describes the agreed target behavior established by architecture
and accepted decisions, whether or not every part is implemented. Roadmap ideas
are not binding until accepted. Implementation status belongs in planning, not
in architecture or ADRs.

Architecture and ADRs must be understandable without the roadmap or backlog.
Do not link to planning documents or identify concrete Stages, Dev Stories or
Subtasks in their behavioral descriptions, headings, diagrams or verification.
Planning may link to architecture and decisions. General delivery concepts in
the AI collaboration policy are allowed; they do not describe platform behavior.

Describe ADR context through problems, constraints and alternatives. Preserve
technical details, applicability, decision status and supersession links.
Verification sections describe required outcomes and reproducible scenarios,
not reports of completed tasks, test runs or delivery verdicts.

Reusable setup instructions, walkthroughs and checklists are maintained project
knowledge. Reports confirming a particular execution or review are delivery
output governed by the [AI collaboration policy](architecture/ai-collaboration.md#delivery-output).

## Architecture

- [Architecture README](architecture/README.md)
- [System overview](architecture/system-overview.md)
- [Control loop](architecture/control-loop.md)
- [Devices](architecture/devices.md)
- [Events and commands](architecture/events-and-commands.md)
- [Reliability and testing](architecture/reliability-and-testing.md)
- [Architecture examples](architecture/examples.md)
- [AI collaboration model](architecture/ai-collaboration.md)

## Development

- [Coding and testing conventions](development/coding-guidelines.md)
- [Frontend development conventions](development/frontend-guidelines.md)

## Planning

- [Planning README](planning/README.md)
- [Development goal and project direction](planning/goal.md)
- [Roadmap](planning/roadmap.md)
- [Required hardware](planning/hardware.md)

## Decisions And Supporting Documents

- [System context diagram](architecture/system-context.md)
- [Trade-offs and decision log](decisions/tradeoffs.md)
- [Decision records](decisions/README.md)
- [ADR template](decisions/adr-template.md)

Use [architecture](architecture/) for the agreed target system model and behavior.
Use [decisions](decisions/) for durable architectural decisions and trade-offs.
Use [planning](planning/) for direction, roadmap and learning intent.
