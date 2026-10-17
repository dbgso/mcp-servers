---
id: 01M54YS4EBY6NG0NREYDT0M9CQ
type: spec
title: claim-chain-mcp の決まりと参照の型の仕様
requires: 01M54YS4E4W5JC0KSJJ8YKN6YA
created: 2026-10-17T12:53:23.000Z
updated: 2026-10-17T12:53:23.000Z
---

# claim-chain-mcp の決まりと参照の型の仕様

要求「上流で決まっていることしか下流に書けないようにする」を、決まり (claim) の単位、
種別ごとの参照の型、足りない上流の記録 (GAP) として規定する。

## 単位

- **決まり 1 件 = 単独で破れるもの 1 つ。** 1 件に入れる決まりは 1 つだけ。
- 1 件 = 1 ファイル。`<root>/<種別>/<id>.yaml`。
- id はツールが発行する。形は `<種別>-<4 桁の連番>`。書く人は id を決めない。

## 種別と参照の型

既定の種別。設定ファイル `<root>/claim-chain.config.yaml` で置き換えられる。

| 種別 | 意味 | 指す種別 (個数) | 必須の欄 | 下に必ず要る種別 |
|---|---|---|---|---|
| DEF | 用語 | なし | `term`, `meaning` | — |
| P | 原則 | DEF (1 以上) | `modality` (`must` / `must_not`), `statement` | C |
| C | 基準 | P (ちょうど 1)、DEF (0 以上) | `condition` | S |
| S | spec の振る舞い | C (1 以上) | `behavior` | — |
| D | design の理由 | S (1 以上) | `reason`, `rejected` | — |

- 表に無い種別を指すこと、表に無い欄を持つことは、どちらも違反とする。
- P には条件の欄が無い。例外を書く場所は形の上で存在しない。

## 版

- 決まりの版は、種別と欄の内容から計算する hash (先頭 12 文字) とする。保存しない。
- 参照は、指した時点の相手の版を持つ。相手の今の版と違えば、その参照は古い。

## 足りない上流 (GAP)

- `add` で、ある種別の参照が最小個数に足りないとき、`want` (何が決まっていないか) が
  あれば GAP を作り、下書きを GAP に保存して、`add` は失敗として返す。`want` が無ければ、
  GAP は作らず、`want` を付けて呼び直すよう返す。
- GAP は `needs` (足りない種別)、`under` (下書きが指していた id)、`want`、`draft` (下書き)、
  `status` (`open` / `resolved`) を持つ。
- 存在しない id や型の合わない参照は GAP にしない。打ち間違いと区別がつかないため、
  エラーとして返す。

## 書けるようになった下流

- `add` が成功したら、その決まりで解ける open な GAP を応答に含める。解けるとは、GAP の
  `needs` がその決まりの種別と同じで、`under` が空か、その決まりが `under` の id か、
  その決まりが `under` のどれかを指していること。
- `add` に `resolves: <GAP の id>` を渡すと、成功したときにその GAP を `resolved` にする。

## 検査 (`check`)

| 検査 | 違反 |
|---|---|
| `missing-ref` | 参照先が存在しない |
| `wrong-kind` | 参照先の種別が表に無い |
| `ref-count` | ある種別の参照が最小個数より少ない、または最大個数より多い |
| `missing-field` / `unknown-field` / `invalid-field` | 必須の欄が無い、表に無い欄がある、値が許されたものでない |
| `uncovered` | 下に必ず要る種別の決まりが、1 件もその決まりを指していない |
| `stale-ref` | 参照が持つ版が、相手の今の版と違う |
| `open-gap` | 解かれていない GAP がある (警告) |

警告以外が 1 件でもあれば失敗とする。同じ検査を CLI (`claim-chain-mcp check <root>`) でも
出し、失敗なら終了コード 1 を返す。

## ツールの形

`describe` と `execute` の 2 つ。`execute` の入力 schema は引数を名指ししない
(`policy__mcp-tool-surface`)。`action` で次を切り替える。

| action | すること |
|---|---|
| `add` | 種別・欄・参照を受け取り、型を満たせば id を発行して保存する |
| `update` | 欄か参照を変える。版が変わったら、古くなった下流を返す |
| `read` | 1 件と、それを指している決まり |
| `list` | 種別ごとの一覧 |
| `check` | 上の表の検査 |
| `gaps` | open な GAP |
| `unblocked` | 指定した決まりで解ける GAP |
| `trace` | 上流 (`up`) か下流 (`down`) をたどる |
