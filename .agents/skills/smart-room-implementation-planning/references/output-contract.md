# Planning Output Contract

Return an implementation-ready plan with this structure: 1. Goal and scope 2. Confirmed behavior, constraints and non-goals 3. Files and symbols to change 4. Ordered implementation steps 5. Acceptance criteria 6. Executable scenarios and verification 7. Definition of done 8. Goal suitability and Goal Execution Contract when suitable 9. Risks, assumptions and human decisions 10. Evidence reviewed

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
