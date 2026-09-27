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

**条件付き必須が、コードと散文にしかない。** `list(backlinks)` は `id` を必要とするが、
その依存は `if (backlinks && id)` と help の文面にあるだけで、**機械的な検査は無い**。
同じ形の穴は他のアクションにも空いている:

| アクション | 条件付き要件 | 今どこにあるか |
| --- | --- | --- |
| `list` | `backlinks` は `id` を要する | `if (backlinks && id)`、describe の文面 |
| `list` | `drafts` は他のフィルタと併用不可 | `doExecute` 冒頭の拒否 |
| `set_status` | `id` か `ids` のどちらか | `doExecute` |
| `approve` | `id` か `ids` のどちらか / batch では `targetId` が無視される | `doExecute`、無視は記述のみ |
| `update` | 変更フィールドが最低1つ | `doExecute` |

### 当初の記述の誤り

ここには当初「`.refine` はマージされる inputSchema を壊すため使えない」と書いてあった。**これは誤り**で、
`update.ts` の同趣旨のコメントも同じ誤りだった。`.refine` は `ZodEffects` を返し `.shape` を持たないが、
ラッパは中身を保持しているので `buildInputSchema` が `innerType()` を辿れば shape は取り出せる。
`BaseActionHandler` は `safeParse` で検証するため、refinement はディスパッチ時に実際に効く。
`buildInputSchema` はそう直した。

### それでも残る判断

スキーマに移すこと自体には値がある。`describe-matches-schemas` テストは describe の例をスキーマに
かけているので、条件付き必須がスキーマにあれば**例の側の齟齬が自動で落ちる** — 今回見つかった
`list(backlinks: true)` の記述ミスは、これで二度と通らなくなる。

ただし `execute` は検証失敗を `parsed.error.message` として返し、これは issue の JSON 配列になる。
今ハンドラが返している「理由 + 次に取る行動」の文面は失われる。`drafts` の衝突拒否のように、
**どのフィルタが衝突したかを名指しして代替を2つ示す**類の応答は refinement では出せない。

したがって片方に寄せるのではなく、スキーマに制約を置いたうえで `execute` が issue の message を
そのまま見せる形が要る。次アクションの提示まで含めるなら `ZodLikeSchema` 側に手が入るので、
この PR の範囲を超える。

## レビューで落ちた点と、その修正

この設計は一度 sub agent のレビューを通らなかった。落ちた理由は実装の誤りというより、
**仕様を一般則として書きながら、実装が1ハンドラ分しかなかった**ことにある。

| 指摘 | 対応 |
|---|---|
| 「対象外を存在しないと言うな」が `graph` にしか入っていない | `set_status` と `approve` にも同じ分岐を入れた（`noDraftReason` に集約） |
| コーパス分割を外しても全テストが通る | 理由づけが誤っていた（`checkOrphanedDocs` は `_` 始まりを元から飛ばす）。**類似と孤立**で検査し直し、どちらも変異で落ちることを確認した（孤立は、被参照集合を渡された全文書から作るため、draft のリンクが promoted 文書の孤立判定を打ち消す）。循環だけは draft が入りようがなく（`relatedDocs` は素の id を、グラフは保存 id をキーにする）、固定できるものが無いので `lint.ts` のコメントに事実として書いた |
| `list(drafts: true)` が拒否される `approve` 呼び出しを返す | ワークフロー状態を見て、未レビューなら `notes` を、揃っていれば `ids` を提案する |
| `drafts` が他のフィルタを黙って作り替える | 組み合わせを拒否する。`list(drafts: true, id: "cat")` が「文書なし」と答えていた |
| 例文スキャナが複数行を見逃し、括弧入りを誤検知する | ファイル全体を対象にし、括弧を数え、値の中を無視する |
| `mentions` が部分一致（`"provide"` が `id` を含む） | `param + ":"` に変更。これで `rename.explanation` の実際の欠落が出た |
| 値を見ていない（`status: "<status>"` はスキーマが拒否する） | literal / enum のパラメータは、例の値が実際の候補であることを要求する |

**`set_status` が成功と失敗を同時に報告していた**（`targetIds.length` で要約を選び、`isError` を
立てない）のも同じ走査で出るべきものだった。要約は結果で選び、失敗があれば `isError` を立てる。

レビューが見つけたもののうち、**3件は「検査したつもりで検査できていなかった」**という形をしている。
機械的な検査を足すときは、その検査自体が落ちることを変異で確かめる必要がある。
