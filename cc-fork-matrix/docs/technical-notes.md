# cc-fork-matrix 技術メモ

この document は README から切り出した実装寄りの補足です。通常利用の手順は
[`../README.md`](../README.md) を参照してください。

## Backend command

launch mode は `codex-cli` と `claude-cli` を support します。

Codex launch target は次の形です。

```text
codex fork <source-session> <variant-prompt> -C <worktree>
```

Claude launch target は matrix-created worktree 内で次を実行します。

```text
claude --resume <source-session> --fork-session --name <run-id>-<variant-slug> <variant-prompt>
```

Claude launch mode では `claude --worktree` は使いません。branch と worktree 作成は
`cc-fork-matrix` が担い、dry-run plan を deterministic に保ちます。

Ask-only mode は Claude CLI print mode だけを support します。ユーザー環境で確認済みの
surface は `-p/--print`、`--resume`、`--fork-session`、`--name`、`--output-format json`、
`--tools ""`、`--permission-mode plan` です。実行 argv は次の形です。

```text
claude -p --resume <source-session> --fork-session --name <run-id>-<question-slug> --output-format json --tools "" --permission-mode plan <ask-prompt>
```

`ask-prompt` は memory 上だけで組み立て、metadata、report、dry-run、shell command には
書きません。Claude CLI の JSON field が変わった場合は推測で進めず、次のような
user-run smoke で current surface を確認してから parser を更新します。

```bash
cd /Users/toshiki.ito/ghq/github.com/faronan/agent-workbench
claude -p --resume "$CLAUDE_CODE_SESSION_ID" --fork-session --name ccfm-json-probe --output-format json --tools "" --permission-mode plan "Reply with exactly: ccfm-json-probe-ok"
```

## Prompt redaction

raw prompt と full terminal launch command は metadata、report、`open` output に書きません。
successful launch 後、variant metadata は `status: running`、
`sessionIdAvailability: unavailable`、および `cd <worktree> && <backend-command>` のような
open-worktree fallback command を記録します。

launch metadata は terminal、layout、launch strategy、
`promptStoragePolicy: not-persisted` などの routing field だけを記録します。
`cc-fork-matrix` 自身を起動した command は記録しません。

launch mode の `--dry-run` は `promptSha256`、branch、worktree、verification command name、
launch target を表示します。raw prompt、`codex fork`、`claude --resume` command は表示しません。

ask-only mode は raw question、raw generated prompt、raw transcript、full backend stdout/stderr
を保存しません。durable metadata は `questionSha256`、name、backend、source、status、
session id availability、summary path に限定します。回答 summary は `redact()` 後に
`summary.md` へ保存します。failure 時だけ redacted/truncated error を metadata に残します。

## Ghostty / Zellij launcher

Ghostty launch mode は `--layout tabs|splits` を support します。variant prompt を含む
launch command では、AppleScript launcher は full shell command を terminal に typing
せず、Ghostty の surface configuration である `command` と `environment variables` を
使います。

prompt argument は一時 environment variable で base64 encode され、短い runner で decode
され、`exec` 前に unset されるため terminal scrollback に表示されません。

Zellij launch mode は `zellij action new-tab` による variant ごとの tab を使い、tabs のみ
support します。full prompt command を manual shell command として表示せず、argv を
Zellij に直接渡します。

## Open command contract

各 variant metadata file は legacy な `resumeCommand` string ではなく、`openCommand`
object を記録します。command は backend-aware で、report に表示して安全な形です。

- captured session id がある Claude variant:
  `cd <worktree> && claude --resume <session-id>`
- captured session id がある Codex variant:
  `cd <worktree> && codex resume <session-id>`
- captured session id が無い variant:
  `cd <worktree> && <backend-command>`

`cc-fork-matrix open <run-dir>` は各 variant の shell command を表示します。
`cc-fork-matrix open --last` も latest pointer から同じ command を表示します。
`--variant <name-or-slug>` で対象を絞れます。`--json` を使うと、`argv`、`cwd`、
launcher-specific command を含む structured contract を確認できます。

## macOS Ghostty open

macOS では Ghostty terminal emulator を `ghostty` CLI から直接 launch できません。
そのため Ghostty launcher は次の形を使います。

```text
open -na Ghostty.app --args --working-directory=<worktree> -e <backend-command>
```

`cc-fork-matrix open <run-dir> --terminal ghostty --layout tabs|splits` は、選択した
variant を AppleScript で Ghostty に開きます。`tabs` は 1 つの新 window に variant ごとの
tab を作成します。`splits` は 1 つの新 window に right/down 交互の split pane を追加します。

Ghostty が未 install、`osascript` が unavailable、または macOS Automation permission が
AppleScript を block している場合、command は non-zero で終了し、自分で実行する manual
command を表示します。

## Zellij open

`cc-fork-matrix open <run-dir|--last> --terminal zellij --layout tabs` は run 全体を
1 つの deterministic session として開きます。session name は短い runId では
`ccfm-<runId>`、Zellij 0.44 の session name 長制限に当たる runId では
`ccfm-<short-hash>` です。1 variant は 1 tab になり、tab name は variant slug、cwd は
`openCommand.command.cwd`、command/args は `openCommand.command.argv` から生成します。
`openCommand` の resume/open 判定を再利用し、backend ごとの判定を Zellij launcher では
再実装しません。

`--dry-run` と `--dry-run --json` は session name、run dir、tab、cwd、command kind、
backend だけを表示します。raw prompt、full launch command、`shellCommand` は表示しません。
既存 active session がある場合は duplicate tab を作らず `zellij attach <session>` します。
同名 session が `(EXITED - attach to resurrect)` の場合は古い serialized layout を
resurrect せず、`zellij delete-session --force <session>` を案内する user-facing error に
します。

Zellij open は run workspace 全体を開くため、`--variant` とは併用できません。
tmux は target launcher ではありません。

## Metadata compatibility

`cc-fork-matrix` は active development 中で、古い run artifact との互換性は保証しません。
metadata schema が変わった後は、古い artifact を再利用せず run を再生成してください。
