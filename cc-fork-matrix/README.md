# cc-fork-matrix

`cc-fork-matrix` fans out a Claude Code or Codex session into multiple hypothesis sessions,
each isolated in its own git worktree and branch. It records verification results,
diffs, metadata, and a comparison report without copying raw transcripts or prompts.

## Quick Start

`cc-fork-matrix` is a local clone + build tool. npm publish is not required for
the current workflow, and the normal invocation is `cc-fork-matrix ...` from
your shell PATH.

```bash
pnpm --dir cc-fork-matrix install-local
cc-fork-matrix --help
```

On another Mac, clone this repository through `ghq` and run the same
`install-local` command. It installs dependencies, builds `dist/cli.js`, places
the wrapper at `~/.local/bin/cc-fork-matrix`, and runs a `--help` smoke test.
The wrapper resolves the clone with
`ghq list -p github.com/faronan/agent-workbench` and runs
`node <repo>/cc-fork-matrix/dist/cli.js`.

If `dist/cli.js` is missing, rebuild it:

```bash
pnpm --dir cc-fork-matrix build
```

For development-only debugging of the TypeScript source, maintainers can still
run `node --experimental-strip-types src/cli.ts ...` from `cc-fork-matrix/`, but
that is not the installed CLI surface.

P1 Run-level Group Launcher is a follow-up task and is not implemented in this
surface-stabilization step.

```bash
cc-fork-matrix dry-run matrix.yaml
cc-fork-matrix run matrix.yaml
cc-fork-matrix run matrix.yaml --launch --terminal ghostty --dry-run
cc-fork-matrix run matrix.yaml --launch --terminal zellij
cc-fork-matrix dry-run --stdin --source current
cc-fork-matrix run --stdin --source current --launch --terminal ghostty
cc-fork-matrix report ../.cc-fork-matrix/my-run/runs/20260526T200000
cc-fork-matrix open ../.cc-fork-matrix/my-run/runs/20260526T200000 --variant zod-contract
cc-fork-matrix open ../.cc-fork-matrix/my-run/runs/20260526T200000 --variant zod-contract --json
cc-fork-matrix open ../.cc-fork-matrix/my-run/runs/20260526T200000 --terminal ghostty --layout tabs --dry-run
cc-fork-matrix list --json
cc-fork-matrix status --last --json
cc-fork-matrix finalize --last --json
cc-fork-matrix report --last
cc-fork-matrix cleanup --last --except zod-contract --dry-run --json
cc-fork-matrix cleanup ../.cc-fork-matrix/my-run/runs/20260526T200000 --dry-run
cc-fork-matrix cleanup ../.cc-fork-matrix/my-run/runs/20260526T200000
```

From agents, use the bundled skill templates:

- Codex: `skills/codex/cc-fork-matrix/SKILL.md`
- Claude Code: `skills/claude/cc-fork-matrix/SKILL.md`

The skills generate a temporary matrix, run `dry-run --stdin --source current`,
wait for explicit user approval, then run
`run --stdin --source current --launch --terminal ghostty`.

## No Matrix File Workflow

When a user asks to try several options in separate sessions, the agent should
generate the matrix YAML in memory and pass it through stdin instead of writing a
matrix file:

```bash
cc-fork-matrix dry-run --stdin --format yaml --source current
```

The dry-run output is the approval surface. Show the resolved branch, worktree,
variant prompt summary, prompt hash, verification command names, and terminal
launch plan for every variant. After approval, pass the same in-memory YAML to:

```bash
cc-fork-matrix run --stdin --format yaml --source current --launch --terminal ghostty
```

Use `--terminal zellij` only when requested. Generated variant prompts must be
short task instructions, not raw transcripts or copied session logs.

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

Before starting variants, the backend runs `codex fork --help` and verifies that
the installed CLI exposes `codex fork [SESSION_ID] [PROMPT]` with `-C/--cd`.
The launched fork session id is not available from the interactive CLI, so reports
record the session as unavailable and emit a worktree-open command such as
`cd <worktree> && codex`.

## Terminal Launch Mode

`run --launch` creates all variant worktrees first, then launches the fork
commands together in a terminal target:

```bash
cc-fork-matrix run matrix.yaml --launch --terminal ghostty
cc-fork-matrix run matrix.yaml --launch --terminal zellij
```

Launch mode is explicit and supports `codex-cli` and `claude-cli`. Codex launch
targets use:

```text
codex fork <source-session> <variant-prompt> -C <worktree>
```

Claude launch targets run inside the matrix-created worktree and use:

```text
claude --resume <source-session> --fork-session --name <run-id>-<variant-slug> <variant-prompt>
```

Claude launch mode does not use `claude --worktree`; `cc-fork-matrix` owns branch
and worktree creation so the dry-run plan remains deterministic.

The raw prompt and full terminal launch command are not written to metadata,
reports, or `open` output. After a successful launch, variant metadata records
`status: running`, `sessionIdAvailability: unavailable`, and an open-worktree
fallback command such as `cd <worktree> && <backend-command>`.

Launch metadata records only machine-readable routing fields such as terminal,
layout, launch strategy, and `promptStoragePolicy: not-persisted`. It does not
record the command used to invoke `cc-fork-matrix` itself.

`--dry-run` for launch mode prints `promptSha256`, `branch`, `worktree`,
verification command names, and the launch target. It does not print the raw
prompt, `codex fork`, or `claude --resume` command.

Ghostty launch mode supports `--layout tabs|splits`. For launch commands that
contain a variant prompt, the AppleScript launcher uses Ghostty's surface
configuration `command` and `environment variables` fields instead of typing the
full shell command into the terminal. Prompt arguments are base64-encoded in
transient environment variables, decoded by a short runner, unset before `exec`,
and are not shown in terminal scrollback.

Zellij launch mode uses one tab per variant through `zellij action new-tab` and
only supports tabs. It passes argv directly to Zellij instead of printing the
full prompt command as a manual shell command.

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

`cc-fork-matrix` is still under active development and does not guarantee
compatibility with old run artifacts. After a metadata schema change, regenerate
the run instead of reusing artifacts created by an older version.

On macOS, Ghostty does not support launching the terminal emulator directly from
the `ghostty` CLI. The Ghostty launcher therefore uses
`open -na Ghostty.app --args --working-directory=<worktree> -e <backend-command>`.

`cc-fork-matrix open <run-dir> --terminal ghostty --layout tabs|splits` opens the
selected variants in Ghostty using AppleScript. `tabs` creates one new window
with a tab per variant. `splits` creates one new window and adds variants as
right/down alternating split panes. The launcher opens the default shell in each
worktree, enters the same manual open command shown by `cc-fork-matrix open`, and
presses enter. Use `--dry-run` to print the generated AppleScript and manual
commands without launching Ghostty.

If Ghostty is not installed, `osascript` is unavailable, or macOS Automation
permissions block AppleScript, the command exits non-zero and prints the manual
commands to run yourself.

Zellij is supported by terminal launch mode. It is not part of the per-variant
`open` command contract. tmux is not a target launcher.

## Cleanup

`cc-fork-matrix cleanup <run-dir>` removes worktrees recorded in that run's
`metadata.json`. `--last` resolves the latest run from `latest.json`, falling
back to valid metadata scan when the pointer is stale:

```bash
cc-fork-matrix cleanup <run-dir> --dry-run
cc-fork-matrix cleanup --last --except option-a --dry-run --json
cc-fork-matrix cleanup <run-dir>
```

Cleanup is metadata-scoped and refuses dirty worktrees by default. Use `--force`
only when you intentionally want to discard uncommitted variant changes. Cleanup
does not delete branches or the run artifact directory unless requested with
`--delete-branches` or `--delete-run-dir`. `--delete-run-dir` is allowed only
when cleaning all variants.

## Follow-up Lifecycle

Use these commands after `run --launch`:

```bash
cc-fork-matrix list --json
cc-fork-matrix status --last --json
cc-fork-matrix finalize --last --json
cc-fork-matrix report --last
cc-fork-matrix cleanup --last --dry-run --json
```

`finalize` closes `running` launch variants by recollecting diffs and changed
files, running stored verification commands, updating metadata, and regenerating
the report. If a running variant has no verification commands, changed worktrees
become `succeeded` and unchanged worktrees become `skipped`.

## Safety

- No automatic `git commit`, `git push`, `git merge`, `git rebase`, or destructive
  cleanup.
- `cleanup` removes only metadata-listed worktrees and refuses dirty worktrees
  unless `--force` is set.
- Dirty base repos stop the run unless `--allow-dirty-base` or
  `run.dirtyBase: allow` is set.
- Raw transcripts and raw prompts are not copied to the ledger.
- Verification and backend logs are redacted before being written.
