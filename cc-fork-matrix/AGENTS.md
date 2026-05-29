# cc-fork-matrix エージェントガイド

この file は `cc-fork-matrix` を触る coding agent 向けの最小限の作業指示です。
詳細な使い方や運用手順は `README.md` を参照してください。

## 対象範囲

- 対象は `cc-fork-matrix/` 配下の Node CLI です。repo root には不要な file を増やさないでください。
- 通常利用 surface は installed CLI の `cc-fork-matrix ...` です。
- `node --experimental-strip-types src/cli.ts ...` は開発時 debug 用で、README や skill の通常手順には出さないでください。
- raw transcript、raw prompt、secrets、full launch command を metadata、report、durable log、assistant output に保存しない方針を維持してください。

## コマンド

- 全体 gate: `pnpm --dir cc-fork-matrix check`
- テスト: `pnpm --dir cc-fork-matrix test`
- 型検査: `pnpm --dir cc-fork-matrix typecheck`
- lint: `pnpm --dir cc-fork-matrix lint`
- build: `pnpm --dir cc-fork-matrix build`
- local install: `pnpm --dir cc-fork-matrix install-local`

`install-local` は `~/.local/bin` と dependency install に触れるため、sandbox や権限で失敗したら
推測で迂回せず、exact command と cwd をユーザーに提示して実行結果を待ってください。

## 実装ルール

- TypeScript source は `src/`、tests は `test/`、local wrapper は `bin/`、build/install helper は `scripts/` にあります。
- CLI の public surface を変える場合は、`src/cli.ts`、README、skill template、関連 tests を一貫して更新してください。
- metadata shape を変える場合は、`src/types.ts`、`src/metadata-contract.ts`、`open`/`report`/`status` 系 tests を同期してください。
- launch/dry-run/report では raw prompt を出さず、`promptSha256` など sanitized field だけを表示してください。
- cleanup は metadata-scoped かつ dry-run first の前提を崩さないでください。dirty worktree refusal は安全動作です。

## 検証方針

- 変更後は原則 `pnpm --dir cc-fork-matrix check` を実行してください。
- narrow change でも、最終確認は `check` を優先してください。Biome formatting drift は `check` で検出します。
- installed CLI や terminal launcher の smoke が必要で Codex 側 PATH/sandbox で確認できない場合は、ユーザーに exact command を依頼してください。
- fake repo smoke は `/tmp` など一時 directory に閉じ、destructive cleanup は実行せず `--dry-run` までにしてください。

## 安全境界

- `git commit`、`git push`、`git merge`、`git rebase`、`git stash`、destructive cleanup はユーザーの明示依頼なしに実行しないでください。
- secrets や credentials を読まないでください。`.env`、`*.pem`、`*.key`、`**/secrets/**`、`**/credentials.json`、`**/.ssh/**`、`**/.aws/**`、`**/.kube/**` は対象外です。
- `dist/cli.js` は build output です。source change の結果として build が必要な場合だけ更新してください。
- 古い metadata artifact との互換性を推測で保たず、schema change 後は rerun を促してください。

## ドキュメント

- README は人間向けの概要、導入、運用 runbook を置く場所です。
- AGENTS.md は agent 向けの command、workflow、boundary に絞ります。詳細手順を重複させず README や skill に委譲してください。
- 実装寄りの補足は `docs/technical-notes.md`、未実装/roadmap は `docs/roadmap.md` に分けてください。
- 新しい運用 command を追加したら、README と bundled skills の user-facing workflow も必要に応じて同期してください。
