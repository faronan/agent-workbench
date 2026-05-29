# cc-fork-matrix Roadmap

この document は README から外した開発中の状況や follow-up scope を置く場所です。
利用者向けの通常手順は [`../README.md`](../README.md) を参照してください。

## 現在の制約

- Run-level Group Launcher は未実装です。
- 複数 variant の起動は `run --launch --terminal ghostty|zellij` を使います。
- Zellij launch mode は tabs のみ support します。
- `open` は `--last` を support しません。`status --last --json` または `list --json` で
  `runDir` を確認してから `open <run-dir>` を実行します。

## Follow-up 候補

- Run-level Group Launcher の設計と実装。
- `open` の latest run 解決を support するかどうかの再検討。
- terminal launcher ごとの user smoke を継続し、README ではなくこの document に結果を残す。
