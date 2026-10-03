---
name: smart-room-commit-changes
description: Prepare scoped Smart Room staging and commits when the user requests staging, committing, commit messages or splitting commits.
---

# Smart Room Commit Changes

Inspect `git status --short`, staged/unstaged diffs and untracked contents before
staging. Treat existing changes as user work unless this session created them.
Stage only the authorized scope; split unrelated commits only when requested.
Do not amend, rebase, reset, stash, clean or force-push without explicit request.
For dubious ownership, use a one-off `git -c safe.directory=...`; do not change
global configuration unless requested.

## Prepare And Commit

- Inspect affected README files and parent indexes when structure, commands,
  configuration, endpoints or navigation change. Update stale guidance, check
  relative links and record whether README updates were needed.
- Run the narrowest relevant verification when practical; report absent commands.
- Stage the intended paths and inspect the staged diff again. A staging-only or
  message-only request does not authorize creating a commit.
- When committing is requested, use a concise imperative subject, normally under
  72 characters, and a body only when it explains the reason. Coherent AI setup
  changes may form one commit; check AGENTS, config, roles, skills and relevant
  architecture/decision docs for consistency.
- Report hash/subject when committed, included files, README impact, verification
  and remaining uncommitted work.
