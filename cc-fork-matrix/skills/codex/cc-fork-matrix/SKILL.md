---
name: cc-fork-matrix
description: Create and launch a cc-fork-matrix experiment from the current Codex session. Use when the user asks to try multiple options in separate Codex sessions/worktrees without hand-writing a matrix file.
argument-hint: '"variant request or path to matrix"'
---

# cc-fork-matrix

Use this skill only when the user explicitly asks to try multiple options in
separate sessions or invokes `cc-fork-matrix`.

## Command

Use the local wrapper command for every example below:

```bash
cc-fork-matrix
```

Refer to it as `<CC_FORK_MATRIX_CMD>` in workflow steps. If the Codex shell PATH
does not include `~/.local/bin`, use this fallback command block:

```bash
$HOME/.local/bin/cc-fork-matrix
```

Do not use the TypeScript source path as the normal command surface. If the
wrapper reports that `dist/cli.js` is missing, run
`pnpm --dir <repo>/cc-fork-matrix build` outside the matrix workflow first.

## Workflow

1. If the user provided a matrix file path, use that file.
2. Otherwise, create a temporary YAML matrix in memory:
   - Use `source.backend: codex-cli`.
   - Use `source.session: current`.
   - Create one variant per requested hypothesis.
   - Keep each variant prompt short and task-focused.
   - Include verification commands only when the user or project context makes them clear.
   - Do not save the matrix file unless the user explicitly asks.
3. Always run a dry run first, passing the matrix through stdin:

   ```bash
   <CC_FORK_MATRIX_CMD> dry-run --stdin --format yaml --source current
   ```

4. Show the resolved branches, worktrees, variant prompt summaries, prompt
   hashes, verification command names, and launch target. Ask for explicit
   approval before launching.
5. After approval, pass the same matrix through stdin and run:

   ```bash
   <CC_FORK_MATRIX_CMD> run --stdin --format yaml --source current --launch --terminal ghostty
   ```

   Use `--terminal zellij` only when the user asked for Zellij.

## Follow-up Protocol

- 「結果見て」: run `<CC_FORK_MATRIX_CMD> status --last --json`; if any variant is
  `running`, run `<CC_FORK_MATRIX_CMD> finalize --last --json`; then run
  `<CC_FORK_MATRIX_CMD> report --last`.
- 「さっきの run をまとめて」: run `<CC_FORK_MATRIX_CMD> status --last --json`
  and `<CC_FORK_MATRIX_CMD> report --last`.
- 「A案だけ残して」: run
  `<CC_FORK_MATRIX_CMD> cleanup --last --except <slug> --dry-run --json`, show the
  result, and ask before running the same cleanup without `--dry-run`.
- 「全部 cleanup して」: run
  `<CC_FORK_MATRIX_CMD> cleanup --last --dry-run --json`, show the result, and ask
  before destructive cleanup.
- 「もう一回 dry-run して」: repeat the cleanup dry run. If the user means the
  matrix launch dry run, regenerate the in-memory matrix because prompts are not
  persisted.

## Safety

- Do not copy raw transcripts into the matrix.
- Do not copy raw prompt history or session logs into variant prompts.
- Do not include secrets in prompts.
- Do not print or persist the full launch command in assistant messages,
  metadata, reports, or dry-run output.
- Do not persist the repository-local tool command in run metadata or reports.
- Use the normal launcher path; do not invent manual shell commands that expose
  the variant prompt in terminal scrollback.
- Do not request `git commit`, `git push`, `git merge`, `git rebase`, `git stash`,
  or destructive cleanup.
- If `CODEX_THREAD_ID` is unavailable, tell the user to pass an explicit source
  session ID.
