---
id: 01M8GM8GVP6FS3HHSB4GCG2C8P
type: design
title: ドリフト検査の構成
requires: 01M8GM8GVCVFXVMF8GQQ3RRH4E
created: 2026-11-28T08:27:31.574Z
updated: 2026-11-28T08:27:31.574Z
baseline:
  01M8GM8GVCVFXVMF8GQQ3RRH4E:
    parent: 27ad589c1c8f7420
    self: 21c3308b0328bb52
    at: 2026-11-28T08:27:31.574Z
---

## 構成

- `hash.ts`: 文書ハッシュとコードパス（ファイル / ディレクトリ / glob）のハッシュ
- `graph.ts`: 全文書のメモリ上のグラフ（親・子・祖先・子孫・循環）
- `analysis/rules.ts`: 検査は Rule インターフェースを実装したクラス。1文書を見て Finding を返す
- `analysis/checker.ts`: 全ルールを全文書に適用し、escalation と「上位の未解決」を求める
- `chain-manager.ts`: check / impact / confirm / bind_code / link / unlink / baseline
- `cli.ts`: Command クラスのレジストリ。MCP と同じ ChainManager を使う

## 伝播は遅延評価

親が変わっても孫は直接フラグされない。子が「変更」された時点で初めて孫がフラグされる。子が「影響なし」と確認されれば、そこで止まる。
