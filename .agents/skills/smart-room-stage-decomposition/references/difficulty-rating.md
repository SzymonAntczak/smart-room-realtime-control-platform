# Difficulty Rating

Rate each work item from `A` through `F`, where `A` is the most difficult and
`F` is banal. Use reasoning difficulty and engineering risk rather than file
count, estimated lines or business importance. Evaluate:

1. architecture novelty;
2. number and importance of system boundaries;
3. contract and semantic risk;
4. lifecycle, time, ordering, concurrency and recovery sensitivity;
5. requirement certainty;
6. verification breadth;
7. blast radius.

### A — Exceptional Or Decision-Blocked

Use for exceptional architecture synthesis, highly coupled reliability work, or
an item whose direct material decision is unresolved. State the blocking human
decision; do not recommend implementation before it is resolved.

### B — High-Risk Or Cross-Boundary

Use when correctness depends on shared contracts, important boundaries,
reliability semantics, lifecycle, time, concurrency, recovery or several
interacting verification layers.

### C — Complex Standard Work

Use for a normal feature in established architecture with several clear
implementation choices and focused verification.

### D — Moderate Bounded Work

Use for established behavior across a small number of clear boundaries with
limited semantic or verification risk.

### E — Small Local Work

Use for a narrow, deterministic change with one primary boundary and a focused
check.

### F — Banal

Use for a mechanical, self-evident edit with negligible blast radius and a
straightforward stopping condition.

Rate a Dev Story separately from its Subtasks. Consider the hardest work on the
critical path, integration risk, story-level acceptance verification and
unresolved dependencies. Do not average Subtask ratings mechanically; several
`C` Subtasks may form an `A` or `B` story when their integration creates
system-level risk.
