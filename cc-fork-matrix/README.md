# cc-fork-matrix

`cc-fork-matrix` fans out a Claude Code session into multiple hypothesis sessions,
each isolated in its own git worktree and branch. It records verification results,
diffs, metadata, and a comparison report without copying raw transcripts or prompts.

## Quick Start

```bash
cc-fork-matrix dry-run matrix.yaml
cc-fork-matrix run matrix.yaml
cc-fork-matrix report ../.cc-fork-matrix/my-run/runs/20260526T200000
cc-fork-matrix open ../.cc-fork-matrix/my-run/runs/20260526T200000 --variant zod-contract --print-command
```

From Claude Code, use the bundled skill template in
`skills/claude/cc-fork-matrix/SKILL.md`. The skill should generate a temporary
matrix, run `dry-run --stdin --source current`, wait for explicit user approval,
then run `run --stdin --source current`.

## Matrix Example

```yaml
version: 1
name: auth-matrix
baseRef: HEAD

source:
  backend: claude-cli
  session: current

run:
  concurrency: 2
  dirtyBase: stop
  failFast: false

backend:
  claude:
    command: claude
    mode: print
    permissionMode: acceptEdits
    maxTurns: 40

verification:
  commands:
    - name: test
      command: pnpm test

variants:
  - name: zod-contract
    prompt: |
      Explore the zod-based contract approach.
```

## Safety

- No automatic `git commit`, `git push`, `git merge`, `git rebase`, or destructive
  cleanup.
- Dirty base repos stop the run unless `--allow-dirty-base` or
  `run.dirtyBase: allow` is set.
- Raw transcripts and raw prompts are not copied to the ledger.
- Verification and backend logs are redacted before being written.
