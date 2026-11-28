---
id: 01M3ENJT7B4XAR9PHSYHRJWXDS
type: requirement
title: draft がどの操作の対象になるかを仕様として決める
created: 2026-09-26T10:54:01.000Z
updated: 2026-09-26T10:54:01.000Z
---

# draft がどの操作の対象になるかを仕様として決める

## 背景

interactive-instruction-mcp は文書を draft（`_mcp_drafts/`）と promoted（通常のディレクトリ）
の2状態で持つ。どのアクションがどちらを対象にするかは、`isInternalDocument` という1つの述語と、
各ハンドラが `DRAFT_PREFIX` を見に行くかどうかで決まっている。

この述語のコメントが挙げている理由はゴミ箱の話だけである。

> `lint` would have reported every trashed document as missing metadata.

draft がそこに同居しているのは、trash を除外する述語にまとめた副作用であり、draft について
判断した形跡がない。その結果、実装の挙動は次のように割れている。

| アクション | draft | promoted |
|---|---|---|
| `read` / `read_meta` / `update` / `link_add` / `link_remove` | 対象 | 対象 |
| `rename` / `delete` | 対象（即時） | 対象（ゲート） |
| `set_status` / `approve` | 対象 | 対象外 |
| `apply` / `cancel` | 対象外 | 対象 |
| **`lint` / `list` / `graph`** | **対象外** | 対象 |

最後の行だけが、どこにも書かれていない。README・changeset・docs のいずれにも「draft は
`lint` の対象外」という記述はなく、根拠は `integration.test.ts` のコメント1行だけである。

> // ListHandler filters out drafts from public listing by design.

## 要求

1. **どのアクションが draft を対象にするかを仕様として明文化する。** 実装がそうなっている、
   ではなく、そう決めた、と読める形で。
2. **明文化した結果と実装が食い違う箇所を、どちらかに寄せる。**
3. **draft に到達できない穴を塞ぐ。** 現状 draft を列挙する手段が1つも無く、`approve` と
   `set_status` がバッチ用に受け取る `ids` を得る方法がない。
4. **同種の乖離が次に起きたとき、機械的に気づけるようにする。** 今回の発見は全て手作業の
   走査によるもので、行カバレッジは 99% あった。行ではなくセル（アクション × 状態 ×
   オプション）が網羅の単位である。

## 発見の経緯

mcp-lab（任意 worktree の MCP サーバーを起動して対話するサーバー）から全アクションを
draft と promoted の両方に対して叩いて比較した。テストでは1つも出ていない。
