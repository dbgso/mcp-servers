---
id: 01M42KKBSSSAMNHJYNKKGVJH6P
type: design
title: 報告 MCP の実装設計
requires: 01M42J5FD0DVHH7DFJETNJ18GS
created: 2026-10-04T04:43:48.000Z
updated: 2026-10-04T10:20:00.000Z
---

# 報告 MCP の実装設計

仕様「報告構造の仕様」をどう実装するか。

## パッケージは2つに分ける

| パッケージ | 責務 | 副作用 |
|---|---|---|
| `mcp-shared-report` | 報告の型・検証・HTML 生成 | なし（pure） |
| `report-mcp` | MCP サーバー。引数を受けて検証し、HTML をファイルに書く | ファイル書き込み |

`mcp-shared-graph-viz` と同じ分け方にする。理由は2つ。

- 検証と HTML 生成は pure なので、入出力の assert だけでテストできる
- 将来、chain への登録など別のサーバーが同じ報告構造を読む可能性がある（要求の対象外だが、分けておく費用は小さい）

## mcp-shared-report

```
src/
  types.ts              報告の型（spec の項目そのまま）       [型のみ]
  validate.ts           入力 → 報告 or 問題の一覧              [pure]
  renderers/
    html/
      index.ts          renderHtml(report) → string
      document.ts       ページのテンプレート
      escape.ts         HTML エスケープ
  index.ts              公開 API
```

### 検証

```ts
type ValidationResult =
  | { ok: true; report: Report }
  | { ok: false; problems: Problem[] };

interface Problem {
  path: string;       // 例: "claims[1].evidence"
  message: string;    // 何が足りないか
  criterion?: string; // 例: "R3"。spec の基準を名指す
}
```

- **問題は全件返す。** 最初の1件で止めない（spec「検証」）
- 問題には spec の基準を付ける。差し戻された側が「なぜ必要か」を読めるように（`policy__criterion-before-detection` の「指摘は基準を名指す」）
- 型の検証は zod で行う。ただし zod のエラーをそのまま返さず、`Problem` に詰め直す

### HTML

- **単一ファイル。スクリプトも CDN も使わない。** 報告は読むだけのもので、オフラインでも開ける必要がある
- light / dark は `prefers-color-scheme` で切り替える
- 入力の文字列は全てエスケープする。AI が HTML を書けない、という要求2をここで担保する
- `evidence[].output` は `<pre>` に入れ、改行と空白を保つ
- `asides` は `<details>` で折りたたむ
- 表示順は spec「表示の順序」に固定する。順序を変える引数は持たない

## report-mcp

### ツール

`policy__mcp-tool-surface` に従い、`describe` と `exec` の2つ。

| ツール | `op` | 内容 |
|---|---|---|
| `describe` | — | 報告の構造、必須項目、読みやすさの基準 R1〜R8、例を返す |
| `exec` | `report` | 報告を受けて検証し、HTML を書いてパスを返す |

呼び出しは `exec(op: "report", title: ..., conclusion: ..., claims: [...], asks: [...])` になる。

- どちらも `inputSchema` は `z.object({}).passthrough()`。検証はハンドラ内で行う
- 配列の引数（`claims` など）はクライアントから文字列で届く。ハンドラのスキーマで `looseArray` を使う（`policy__mcp-tool-surface`「Arguments arrive as strings」）
- `approve` は持たない（下記「承認ゲートは置かない」）
- **基準は `describe` に載せる。** リポジトリの `docs/` はパッケージに同梱されないので、利用者が基準を読める場所は `describe` だけになる（#83 で学んだこと）
- `describe` の例は、テストで `validate` に通す。例と検証のずれを防ぐ

### `exec(op: "report")` の応答

成功時:

```
Report written: /tmp/report-mcp/2026-10-04T04-45-00-<slug>.html
```

失敗時（HTML は書かない）:

```
The report was not written. 2 problems:
- claims[0].evidence: at least one evidence is required (R3)
- asks: required; pass [] if nothing is needed from the reader (R4)
```

### 出力先

`policy__parameterise` に従い、設定にしてデフォルトを持たせる。

| 設定 | 指定方法 | デフォルト |
|---|---|---|
| 出力ディレクトリ | 起動引数 `--output-dir` | `<OS の一時ディレクトリ>/report-mcp` |

- ファイル名は `<タイムスタンプ>-<title の slug>.html`
- **既存ファイルは上書きしない。** 衝突したら連番を付ける

### 承認ゲートは置かない

`policy__approval` は、ゲートの強さを「後ろにあるものの危険度」で選べと言っている。

このツールは、専用ディレクトリに新しいファイルを作るだけで、既存のものを変更も削除もしない。止めるべき破壊がないので、ゲートは置かない。

## テスト

- `mcp-shared-report`: 検証（必須項目ごとの欠落、全件返すこと）、エスケープ、表示順
- `report-mcp`: `describe` の例が `validate` を通ること、失敗時にファイルが書かれないこと、上書きしないこと
- カバレッジは `coding-rules__test-coverage` の 95% を守る
