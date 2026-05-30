# cc-fork-matrix

`cc-fork-matrix` は、Claude Code または Codex のセッションを複数の仮説
セッションへ分岐し、それぞれを独立した git worktree と branch で実行する
ローカル CLI です。複数案の実装・検証・比較を、base repository を汚しにくい形で
進めるために使います。ask-only mode では worktree や branch を作らず、複数の質問を
別 fork session に分離して投げられます。

この tool は検証結果、diff、metadata、比較 report を記録しますが、raw transcript、
raw prompt、secrets は保存しません。

## 何ができるか

- 1 つの matrix から複数 variant の branch/worktree を作成する。
- Claude Code または Codex の fork session を variant ごとに起動する。
- dry-run で branch、worktree、prompt hash、verification command を事前確認する。
- run 後に status/report/finalize で結果を確認する。
- cleanup dry-run で削除対象を確認し、必要な worktree だけ片付ける。
- ask-only mode で複数の advisory question を batch 実行し、回答 summary を保存する。

## インストール / 更新

`cc-fork-matrix` はこの repository の clone から local build して使います。現時点では
npm publish は不要です。

```bash
pnpm --dir cc-fork-matrix install-local
cc-fork-matrix --help
```

`install-local` は dependencies を install し、`dist/cli.js` を build し、
`~/.local/bin/cc-fork-matrix` に wrapper を配置します。wrapper は
`ghq list -p github.com/faronan/agent-workbench` で clone 先を解決して実行します。

`dist/cli.js` が無い、または古い場合は再 build します。

```bash
pnpm --dir cc-fork-matrix build
```

TypeScript source を直接動かす
`node --experimental-strip-types src/cli.ts ...` は開発時 debug 用です。通常利用では
installed CLI の `cc-fork-matrix ...` に統一してください。

## クイックスタート

最小の `matrix.yaml` を用意します。

```yaml
version: 1
name: auth-matrix
baseRef: HEAD

source:
  backend: claude-cli
  session: current

run:
  dirtyBase: stop

backend:
  claude:
    command: claude

verification:
  commands:
    - name: test
      command: pnpm test

variants:
  - name: zod-contract
    prompt: |
      Explore the zod-based contract approach.
```

まず dry-run で計画を確認します。

```bash
cc-fork-matrix dry-run matrix.yaml
```

問題なければ実行します。

```bash
cc-fork-matrix run matrix.yaml
cc-fork-matrix report --last
cc-fork-matrix cleanup --last --dry-run --json
```

## 本運用手順

本運用前に local install と build 済み CLI を確認します。

```bash
pnpm --dir cc-fork-matrix check
pnpm --dir cc-fork-matrix install-local
cc-fork-matrix --help
```

標準 flow は次の順です。

```bash
cc-fork-matrix dry-run matrix.yaml
cc-fork-matrix run matrix.yaml
cc-fork-matrix status --last --json
cc-fork-matrix open <run-dir>
cc-fork-matrix report --last
cc-fork-matrix finalize --last --json
cc-fork-matrix cleanup --last --dry-run --json
```

`run` は run directory を出力します。`open` は `--last` を support していないため、
`run` の出力、`status --last --json`、または `list --json` で `runDir` を確認してから
使います。

terminal launch では通常 `run --launch --terminal ghostty` を使います。Zellij を使う
場合だけ `run --launch --terminal zellij` を指定します。

cleanup は必ず dry-run から始めます。実削除は、operator が JSON 結果を確認し、
metadata-listed worktree を消すことを明示承認した後だけ実行してください。

## Matrix file を保存しない運用

agent が複数案を別 session で試す場合、matrix YAML を memory 上で生成し、file に
保存せず stdin 経由で渡します。

```bash
cc-fork-matrix dry-run --stdin --format yaml --source current
cc-fork-matrix run --stdin --format yaml --source current --launch --terminal ghostty
```

`--terminal zellij` は requested の場合だけ使います。variant prompt は短い task
instruction に限定し、raw transcript や copied session log は含めません。

agent から使う場合は、同梱 skill template を参照します。

- Codex: `skills/codex/cc-fork-matrix/SKILL.md`
- Claude Code: `skills/claude/cc-fork-matrix/SKILL.md`

## Ask-only 運用

同じ session に質問を重ねて context を汚したくない場合は `ask` を使います。`ask` は
worktree、branch、verification、cleanup を使わず、Claude Code の fork session に
質問だけを投げます。

```yaml
version: 1
name: architecture-advice
source:
  backend: claude-cli
  session: current
ask:
  concurrency: 3
questions:
  - name: contract-first
    question: |
      Evaluate the contract-first approach.
  - name: minimal-change
    question: |
      Evaluate the minimal-change approach.
```

file を保存しない daily use では stdin 経由で渡します。

```bash
cc-fork-matrix ask --stdin --format yaml --source current --dry-run
cc-fork-matrix ask --stdin --format yaml --source current
cc-fork-matrix report --last
cc-fork-matrix status --last --json
```

`ask` は raw question、raw generated prompt、raw transcript、backend stdout/stderr を
保存しません。metadata と report には question name、`questionSha256`、status、
session id availability、summary path だけを残します。回答本文は redaction 後に
各 question の `summary.md` へ保存します。

`open`、`finalize`、`cleanup` は ask run では使いません。ask run の確認は `status`、
`report`、`list --json` に統一してください。

## 基本概念

- `matrix`: run 全体の入力設定。backend、source session、variant、verification を定義します。
- `ask config`: worktree を作らない advisory question set です。
- `variant`: 試したい実装案。variant ごとに branch/worktree が作られます。
- `run`: matrix を解決して実行した 1 回分の記録です。
- `ask run`: question ごとの answer summary と metadata を保存する ask-only run です。
- `worktree`: variant を隔離して作業する git worktree です。
- `stateRoot`: run metadata、variant summary、report を保存する directory です。
- `finalize`: launch 後の running variant から diff と verification result を再収集します。
- `cleanup`: metadata に記録された worktree を対象に削除計画または削除を行います。

## Backend と起動

`source.backend` は主に次を使います。

- `claude-cli`: Claude Code session を fork します。session id を capture できる場合があります。
- `codex-cli`: Codex TUI を variant worktree で起動する interactive launcher です。

`codex-cli` で `source.session: current` を使う場合は `CODEX_THREAD_ID` が必要です。
Codex 管理外の session から実行する場合は、`--source <SESSION_ID>` または
`source.session` を指定してください。

`run --launch` は worktree 作成後に terminal target で fork command をまとめて起動します。
Ghostty は `tabs|splits`、Zellij は `tabs` のみを support します。

`ask` は現時点では `claude-cli` のみを support します。Claude CLI print mode で
`--tools ""` と `--permission-mode plan` を指定し、advisory-only に寄せます。
Codex は headless fork capture surface が無いため unsupported です。

内部 command、prompt redaction、Ghostty/Zellij launcher の詳細は
[`docs/technical-notes.md`](docs/technical-notes.md) を参照してください。

## Follow-up 操作

よく使う follow-up command は次です。

```bash
cc-fork-matrix list --json
cc-fork-matrix status --last --json
cc-fork-matrix open <run-dir>
cc-fork-matrix report --last
cc-fork-matrix finalize --last --json
cc-fork-matrix cleanup --last --dry-run --json
```

`open <run-dir>` は variant を再開または worktree で開くための shell command を表示します。
`--variant <name-or-slug>` で対象を絞れます。`--json` を使うと structured output を確認できます。

`cleanup` は metadata-scoped で、dirty worktree は default で拒否します。未 commit の
variant change を意図的に捨てる場合だけ `--force` を使います。branch や run artifact
directory は、`--delete-branches` または `--delete-run-dir` を指定しない限り削除しません。

## 安全性

- raw transcript、raw prompt、secrets は保存しません。
- ask-only mode は raw question を保存せず、`questionSha256` だけを保存します。
- launch/dry-run/report には prompt body や full launch command を出しません。
- base repo が dirty の場合、`--allow-dirty-base` または `run.dirtyBase: allow` が無い限り
  run を停止します。
- `git commit`、`git push`、`git merge`、`git rebase`、destructive cleanup は自動実行しません。
- cleanup は dry-run first で、dirty worktree を default で拒否します。

## トラブルシュート

### `cc-fork-matrix: built CLI not found`

build output がありません。次を実行してください。

```bash
pnpm --dir cc-fork-matrix build
```

### `cc-fork-matrix: command not found`

local wrapper が PATH に入っていない可能性があります。

```bash
pnpm --dir cc-fork-matrix install-local
$HOME/.local/bin/cc-fork-matrix --help
```

### `cleanup` が dirty worktree を拒否する

variant worktree に未 commit の変更があります。まず worktree を確認してください。
変更を捨てる意図が明確な場合だけ `--force` を使います。

### `open --last` が使えない

`open` は explicit な `<run-dir>` を要求します。`status --last --json` または
`list --json` で `runDir` を確認してから実行してください。

## 開発

開発時の基本 gate は次です。

```bash
pnpm --dir cc-fork-matrix check
```

個別には `test`、`typecheck`、`lint`、`build` を使えます。CLI surface、metadata shape、
launcher behavior を変える場合は、README、bundled skills、関連 tests を一貫して更新してください。

追加の設計メモ:

- [`docs/technical-notes.md`](docs/technical-notes.md)
- [`docs/roadmap.md`](docs/roadmap.md)
