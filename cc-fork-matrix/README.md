# cc-fork-matrix

`cc-fork-matrix` fans out a Claude Code or Codex session into multiple hypothesis sessions,
each isolated in its own git worktree and branch. It records verification results,
diffs, metadata, and a comparison report without copying raw transcripts or prompts.

## Quick Start

```bash
cc-fork-matrix dry-run matrix.yaml
cc-fork-matrix run matrix.yaml
cc-fork-matrix report ../.cc-fork-matrix/my-run/runs/20260526T200000
cc-fork-matrix open ../.cc-fork-matrix/my-run/runs/20260526T200000 --variant zod-contract
cc-fork-matrix open ../.cc-fork-matrix/my-run/runs/20260526T200000 --variant zod-contract --json
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

## Codex Backend

`codex-cli` is an interactive fork launcher. It starts a Codex TUI for each
variant with the current worktree as the agent root:

```yaml
version: 1
name: codex-auth-matrix

source:
  backend: codex-cli
  session: current

run:
  concurrency: 1

backend:
  codex:
    command: codex

variants:
  - name: contract-first
    prompt: |
      Explore the contract-first implementation path.
```

For `source.session: current`, `codex-cli` requires `CODEX_THREAD_ID` and passes it
as the explicit `SESSION_ID` to `codex fork`. It does not fall back to
`codex fork --last`; pass `--source <SESSION_ID>` or set `source.session` when
running outside a Codex-managed session.

Before launching variants, the backend runs `codex fork --help` and verifies that
the installed CLI exposes `codex fork [SESSION_ID] [PROMPT]` with `-C/--cd`.
The launched fork session id is not available from the interactive CLI, so reports
record the session as unavailable and emit a worktree-open command such as
`cd <worktree> && codex`.

## Open Command Contract

Each variant metadata file records an `openCommand` object instead of a legacy
`resumeCommand` string. The command is backend-aware and safe to show in reports:

- Claude variants with a captured session id use
  `cd <worktree> && claude --resume <session-id>`.
- Codex variants with a captured session id use
  `cd <worktree> && codex resume <session-id>`.
- Variants without a captured session id use
  `cd <worktree> && <backend-command>` so a human can continue from the isolated
  worktree even when resume metadata is unavailable.

`cc-fork-matrix open <run-dir>` prints the shell command for each variant, and
`--variant <name-or-slug>` filters the output. Use `--json` to inspect the full
structured contract, including `argv`, `cwd`, and launcher-specific commands.

On macOS, Ghostty does not support launching the terminal emulator directly from
the `ghostty` CLI. The Ghostty launcher therefore uses
`open -na Ghostty.app --args --working-directory=<worktree> -e <backend-command>`.

Zellij can script tabs and panes, but that would be a run-level group launcher
rather than a per-variant open command. It is intentionally not part of this
contract. tmux is not a target launcher.

## Safety

- No automatic `git commit`, `git push`, `git merge`, `git rebase`, or destructive
  cleanup.
- Dirty base repos stop the run unless `--allow-dirty-base` or
  `run.dirtyBase: allow` is set.
- Raw transcripts and raw prompts are not copied to the ledger.
- Verification and backend logs are redacted before being written.
