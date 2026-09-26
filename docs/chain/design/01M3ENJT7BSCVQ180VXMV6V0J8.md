---
id: 01M3ENJT7BSCVQ180VXMV6V0J8
type: design
title: draft スコープの実装と、次に気づくための仕掛け
requires: 01M3ENJT7B4DJ90YDN1EK6454S
created: 2026-09-26T11:01:22.000Z
updated: 2026-09-26T11:01:22.000Z
---

# draft スコープの実装と、次に気づくための仕掛け

仕様「draft と promoted の操作対象仕様」をどう実装したか。

## 1. 述語を2つに割る

`isInternalDocument` は draft と trash をまとめて「内部」と呼んでいた。この2つは**内部である
理由が違う**。trash に入った文書はもう文書ではない。draft は完成していないだけの文書である。

`isTrashedDocument` を分け、`lint` は次の2つの集合を使う。

```ts
const documents = result.documents.filter((d) => !isTrashedDocument(d.id)); // 文書単体ルール
const corpus = documents.filter((d) => !isInternalDocument(d.id));          // コーパス横断ルール
```

`checkDocument`（サイズ・重複見出し・メタデータ欠落）は `documents` に、孤立・類似・循環参照は
`corpus` に当てる。この分割は `document-lint.ts` が既に文書単体ルールを切り出していたので、
ループを2種類に分けるだけで済んだ。

報告の id は素の id に戻す（`too-long (draft)`）。`_mcp_drafts__too-long` は**ファイルの
置き場所であって、他のどのアクションも受け付けない文字列**である。

## 2. 到達性: `list(drafts: true)`

既定の `list` は変えない。`drafts: true` のときだけ draft を素の id で列挙し、next actions に
`approve(ids: "one,two")` をそのまま組み立てて返す。バッチ用の id を**同じツールで得られる**と
いうのが要求だったので、列挙して終わりにせず、次の呼び出しの形まで出す。

## 3. 対象外の言い方

`graph(id: <draft>)` は「その文書は draft なので関連グラフには含まれない」と答え、
`read_meta` と `graph`（コーパス全体）を次の行き先として示す。存在しない id には従来どおり
`not found` を返す。**両方を1つの分岐で返し分ける**ので、片方だけ直る余地がない。

## 4. 次に気づくための仕掛け

今回の発見は全て手作業の走査によるもので、行カバレッジは 99% あった。**行ではなくセルが
網羅の単位**である、という要求に対して、この PR で入れたのは次の2つ。

### 4.1 パラメータは必ずどこかに書かれている

`describe-matches-schemas.test.ts` を、必須パラメータの照合から**全パラメータ**の照合に広げた。
各アクションのスキーマに存在する引数は、`instruction_describe` の例か、そのハンドラの `help`
のどちらかに現れなければならない。`help` を認めるのは、それが検証失敗時に返る文面だからである。

これで `add(relatedDocs)` と `graph(format)` のような「動くが誰も知らない引数」が出る。

### 4.2 状態ごとの契約はテーブルとテストの両方にある

`draft-scope.test.ts` が仕様のテーブルをそのまま検査する。アクションを足したときに、
draft と promoted のどちらを対象にするか決めないまま通ることはできる（そこまでは機械化
できていない）が、**決めたことが実装と食い違えば落ちる**。

## 積み残し

**条件付き必須がスキーマに表現できない。** `list(backlinks)` は `id` を必要とするが、
`.refine` はマージされる inputSchema を壊すため使えず、依存は `if (backlinks && id)` という
コードと散文にしかない。今回は describe の記述を直して `id` 付きの形だけを示したが、
**機械的な検査は無い**。同じ形の穴は他のアクションにも作れる。

これを塞ぐには、条件付き必須を宣言として持ち、describe とランタイムの両方がそれを読む形が要る。
単一ツールに全アクションを載せる構造そのものから来る制約なので、この PR の範囲を超える。
