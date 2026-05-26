---
name: smart-room-commit-changes
description: Use when the user asks Codex to commit, create a git commit, stage changes, write a commit message, split changes into commits, or prepare a clean commit in the Smart Room repository. This skill enforces careful diff review, scoped staging, verification notes, and protection of unrelated user changes.
---

# Smart Room Commit Changes

Use this skill to turn finished work into one or more clean Git commits.

## Core Rules

- Never commit before inspecting `git status` and the relevant diffs.
- Treat untracked and modified files as user work unless this session clearly
  created them.
- Do not stage unrelated changes just because they are present.
- Do not amend, rebase, reset, stash, clean, or force-push unless the user
  explicitly asks.
- If the worktree contains unrelated changes, commit only the intended paths or
  ask the user to choose the scope.
- If Git reports dubious ownership, use a one-off `git -c safe.directory=...`
  command rather than changing global Git config unless the user asks.

## Workflow

1. Check repository state:
   - `git status --short`
   - inspect staged changes with `git diff --cached`
   - inspect unstaged changes with `git diff`
   - include untracked files by reading their contents before staging
2. Decide commit scope:
   - group closely related changes into one commit
   - split unrelated changes into separate commits only when the user wants that
   - leave unrelated user changes unstaged
3. Verify when practical:
   - run the narrowest relevant test, lint, typecheck, or documentation check
   - if no command exists, say that explicitly in the final summary
4. Stage only intended files.
5. Re-check staged diff before committing.
6. Write a concise imperative commit message.
7. Run `git commit -m "<message>"`.
8. Report commit hash, commit message, files included, and verification.

## Commit Message Style

Prefer a short imperative subject:

- `Add Codex repo guidance`
- `Document command lifecycle rules`
- `Add smart room commit workflow skill`

Use a body only when it helps explain why the change matters. Keep the subject
under 72 characters when practical.

## Before Committing Current Project Docs

For this repository, consider whether documentation or AI-environment changes
affect:

- `AGENTS.md`
- `.codex/config.toml`
- `.codex/agents/`
- `.agents/skills/`
- `docs/architecture/`
- `docs/decisions/`

AI-environment setup changes can usually be one commit when they form a coherent
working setup.

## Final Summary

After committing, include:

- commit hash
- commit subject
- staged/committed files
- verification performed or why none was run
- any remaining uncommitted changes
