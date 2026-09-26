---
id: 01M3ENJT7B4DJ90YDN1EK6454S
type: spec
title: draft と promoted の操作対象仕様
requires: 01M3ENJT7B4XAR9PHSYHRJWXDS
created: 2026-09-26T10:54:27.000Z
updated: 2026-09-26T10:54:27.000Z
---

# draft と promoted の操作対象仕様

要求「draft がどの操作の対象になるかを仕様として決める」を、アクションごとの契約として規定する。

## 原則

**文書の状態ではなく、ルールの性質で決める。**

- **文書単体で判定できること**は、draft でも promoted でも同じく当てはまる。サイズも重複見出しも
  メタデータ欠落も、昇格した瞬間に意味が変わるものではない。
- **コーパス全体を見ないと判定できないこと**は、promoted だけを対象にする。誰からもリンク
  されていない draft は異常ではなく、書きかけの正常な姿である。全 draft が毎回
  `orphaned-document` として報告されるのは、報告が無いことより悪い。
- **ワークフロー上の操作**は、その状態にしか存在しない。`approve` は draft を昇格させるもので
  あり、`apply` / `cancel` は promoted に対して積まれた変更を扱う。

## アクション別の契約

| アクション | draft | promoted | 根拠 |
|---|---|---|---|
| `read` / `read_meta` | 対象 | 対象 | id は素のまま。draft は `**[Draft]**` と示す |
| `add` | 生成する | — | 生成物は必ず draft |
| `update` | 直接上書き | pending diff → `apply` | ゲートの有無が状態で変わる |
| `rename` / `delete` | 即時 | ゲート（3回） | 可逆性が状態で変わる |
| `link_add` / `link_remove` | 対象（ゲート2回） | 対象（ゲート2回） | `relatedDocs` は素の id で相手を指す |
| `approve` | 対象 | 対象外 | 昇格済みに昇格は無い |
| `set_status` | 対象 | 対象外 | ワークフロー状態は draft にしか無い |
| `apply` / `cancel` | 対象外 | 対象 | pending update は promoted にしか積まれない |
| **`lint`（文書単体ルール）** | **対象** | 対象 | サイズ・重複見出し・メタデータ欠落 |
| **`lint`（コーパス横断ルール）** | **対象外** | 対象 | 孤立・類似・循環参照 |
| `list` | **`drafts: true` のときのみ** | 既定で対象 | 既定の一覧は完成した文書の一覧である |
| `graph` | 対象外 | 対象 | 関連グラフはコーパスの構造を見るもの |
| trash（`_mcp_trash/`） | — | 全アクションで対象外 | 削除済みは文書ではない |

## 対象外のときの応答

**存在しない、と言ってはならない。** draft は存在する。対象外であることと、見つからないことは
別の事実であり、前者を後者として報告すると、呼び出し側は id を間違えたと考えて探し直す。

- `graph(id: <draft>)` → 「その文書は draft なので関連グラフには含まれない」
- `set_status(id: <promoted>)` → 「昇格済みの文書にワークフロー状態は無い」

## 到達性

**バッチ操作が受け取る id は、同じツールで得られなければならない。** `approve` と
`set_status` は `ids` を取るのに、draft を列挙する手段が無い。`list(drafts: true)` で
draft のみを列挙できることとする。既定の `list` の出力は変えない。

## 文書化

この表は README に載せる。`instruction_describe` は、各アクションが draft と promoted の
どちらを対象にするかが読み取れること。
