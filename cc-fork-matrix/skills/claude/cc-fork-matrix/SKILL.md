---
name: cc-fork-matrix
description: Create and run a cc-fork-matrix experiment from the current Claude Code session. Use when the user explicitly asks to fork the current conversation into multiple hypothesis sessions/worktrees.
argument-hint: '"variant request or path to matrix"'
disable-model-invocation: true
allowed-tools:
  - Bash(cc-fork-matrix *)
  - Read
  - Write
---

# cc-fork-matrix

Use this skill only when the user explicitly invokes it. Do not run it
automatically.

## Workflow

1. If `$ARGUMENTS` points to an existing `.yaml`, `.yml`, `.toml`, or `.json` file,
   use that matrix file.
2. Otherwise, create a temporary matrix from the user's request:
   - Use `source.session: current`.
   - Create one variant per requested hypothesis.
   - Use concise, specific variant prompts grounded in the current conversation.
   - Include verification commands only when the user or project context makes them clear.
3. Always run a dry run first:

   ```bash
   cc-fork-matrix dry-run --stdin --format yaml --source current
   ```

4. Show the resolved branches, worktrees, and verification commands. Ask the user
   for explicit approval before starting the real run.
5. After approval, run:

   ```bash
   cc-fork-matrix run --stdin --format yaml --source current
   ```

## Safety

- Do not copy raw transcripts into the matrix.
- Do not include secrets in prompts.
- Do not request `git commit`, `git push`, `git merge`, `git rebase`, `git stash`,
  or destructive cleanup.
- If `CLAUDE_CODE_SESSION_ID` is unavailable, tell the user to pass an explicit
  source session ID or name.
