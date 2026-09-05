---
id: 01M1R3THBV476397KVN4VAF6BW
type: design
title: mcp-shared-graph-viz 実装設計
requires: 01M1R3GH8CWAPDCSEM3WQTTZ81
created: 2026-09-05T06:24:18.811Z
updated: 2026-09-05T06:24:18.811Z
---

# mcp-shared-graph-viz 実装設計

仕様「mcp-shared-graph-viz パッケージ仕様」をどう実装するか。

## 最重要の設計判断: cytoscape はレイアウトエンジンとしてのみ使う

cytoscape は本来ブラウザ用ライブラリで、**描画は canvas に依存するため headless では使えない**。一方でレイアウト計算（座標算出）は headless で動くことを実行確認した。

したがって:

```
GraphInput ──▶ cytoscape (headless)  ──▶ LaidOutGraph ──▶ 自前 SVG 生成
               座標計算のみ                          描画は自分でやる
```

この分割により canvas / puppeteer / ヘッドレスブラウザへの依存が不要になる。

### 実行して発見した headless 固有の落とし穴（これを吸収するのが本ライブラリの価値）

| 現象 | 原因 | 対策 |
|---|---|---|
| `breadthfirst` の座標が `a(-4.375e+49, 0)` になる | headless だと `cy.width()/height()` が 0 になり、レイアウトが 0 除算相当の計算をする | 面積ベースのレイアウトにのみ `boundingBox` を明示指定する（下記の訂正を参照） |
| dagre / cose でノードが重なる | cytoscape はレイアウト結果を `boundingBox` に**リスケール**する。dagre が計算した間隔が箱への引き伸ばしで上書きされる | dagre / cose / preset には `boundingBox` を渡さない |
| 要素定義の `position` が無視される | headless では反映されない | `preset` は `positions` オプションでレイアウトに直接渡す |
| Node プロセスが終了しない | cytoscape インスタンスがハンドルを保持する | `try/finally` で必ず `cy.destroy()` |
| レイアウト完了を待てない | 一部レイアウトは非同期 | `layoutstop` を Promise 化して await |

呼び出し側はこれらを一切知らなくてよい。

### 訂正（実装フェーズの検証結果を反映）

当初この設計は「`boundingBox` を**常に**明示指定する」としていた。これは誤りだった。

cytoscape はレイアウト結果を `boundingBox` に**リスケール**するため、dagre / cose に渡すと、それらが計算した適切な間隔が固定サイズの箱への引き伸ばしで上書きされ、ノードが重なる。

実測（孤立ノード6件 + a→b、dagre LR）:

| | y 座標 |
|---|---|
| boundingBox あり | 0, 133, 267, 400, 533, 667 — 800 を正確に6等分（＝リスケール）。高さ56のノードが重なる |
| boundingBox なし | 19, 106, 193, 280, 367, 454 — 87px 間隔。`nodeSep` が生きている |

したがって `boundingBox` は**面積ベースのレイアウト**（grid / circle / concentric / breadthfirst）にのみ渡す。さらにその箱も固定 1200x800 ではなく、ノードの総面積から算出する（`estimateBoundingBox`）。固定値だと小さいグラフが引き伸ばされ、大きいグラフが押し込められるため。

詳細は implementation 文書を参照。

## ファイル構成（pure / impure 分離）

```
src/
  types.ts          入力型・出力型・オプション型            [型のみ]
  errors.ts         入力検証（id 重複・孤立エッジ）              [pure]
  theme.ts          パレット、group → 色の決定的割当             [pure]
  measure.ts        ラベル幅推定・折り返し・ノードサイズ算出   [pure]
  elements.ts       GraphInput → cytoscape elements              [pure]
  layout.ts         cytoscape headless 実行                       [impure/async]
  svg/
    escape.ts       XML エスケープ                                [pure]
    geometry.ts     境界クリップ・矢印・自己ループ・多重辺     [pure]
    render.ts       LaidOutGraph → SVG 文字列                    [pure]
  html.ts           GraphInput → インタラクティブ HTML            [pure]
  index.ts          公開 API
```

**impure は `layout.ts` の 1 ファイルに隔離されている**。ロジックの大半は pure なので、入出力の assert だけでテストできる（`coding__pure-function-extraction`、カバレッジ 95% 要件）。

## 主要アルゴリズム

### ラベル幅推定（measure.ts）

canvas がないので実測不可。コードポイント単位で幅係数を割り当てて合算する。

| 文字種 | 係数 (em) |
|---|---|
| CJK（漢字・かな・全角） | 1.0 |
| 英数・半角記号 | 0.6 |
| 狭い文字 (i, l, j, ., :, space 等) | 0.3 |

`measureLabel` オプションで差し替え可能にし、フォントの実情に合わない場合の逃げ道を残す。

折り返しは単語境界優先。CJK は単語境界がないため文字単位で切る。

### 色の決定的割当（theme.ts）

`group` 名を**ノード配列での初出順**に並べ、その index でパレットを引く。ハッシュではなく出現順にする理由は、少数の group でも確実に色が分かれ（衝突しない）、かつ同じ入力に対して常に同じ結果になるため。

パレットは背景（淡色）と線（濃色）のペアで持ち、ラベルの可読性を確保する。

### エッジの境界クリップ（svg/geometry.ts）

ノード中心同士を結ぶ線分を、矩形・楕円の境界でクリップする。

- 矩形: 中心からの方向ベクトルを半幅/半高でスケールし、小さい方の t を採用
- 楕円: 楕円の媒介変数表現から交点を直接算出

矢印は終点での進行方向から三角形を生成する。

同じノード対を結ぶエッジが複数ある場合は、中点を法線方向にオフセットした二次ベジェ曲線にする。オフセット量は `±(i+1)/2 × spacing` で左右交互に振る。

自己ループはノード上部の弧として描く（上辺の2点を結ぶ三次ベジェ）。

### レイアウト実行（layout.ts）

```ts
const cy = cytoscape({ headless: true, styleEnabled: true, elements, style });
try {
  // boundingBox は面積ベースのレイアウトにのみ含まれる（buildLayoutSpec が判断）
  const layout = cy.layout(spec);
  await new Promise<void>((resolve) => {
    layout.one("layoutstop", () => resolve());
    layout.run();
  });
  return extractLaidOutGraph({ cy, graph });
} finally {
  cy.destroy();  // これがないとプロセスが終わらない
}
```

ノードサイズは cytoscape に任せず、`measure.ts` で先に確定させて style として渡す。これによりレイアウトが実寸法を考慮し、描画時にサイズが食い違わない。

`preset` レイアウト（呼び出し側が座標を持っているケース）をサポートし、テストでの完全な決定性確保にも使う。

### HTML 出力（html.ts）

レイアウトをブラウザ側の cytoscape に任せるので同期関数にできる。elements を JSON で埋め込み、cytoscape 本体は CDN から読む。

埋め込み JSON は `</script>` を `<\/script>` に置換してスクリプトブレイクを防ぐ。

## 依存の扱い

`cytoscape` / `cytoscape-dagre` / `@types/cytoscape` を pnpm-workspace.yaml の catalog に追加し、バージョンを集中管理する（既存の依存全てが catalog 経由のため）。

`cytoscape.use(dagre)` は二重登録すると警告が出るので、モジュールロード時に1回だけ実行する（フラグでガード）。

## テスト方針

- pure 関数は `it.each` + 型付きテストデータ変数（`coding-rules__typescript`）
- `layout.ts` は決定的レイアウト（`preset` / `grid` / `dagre`）でテスト。`cose` は乱数を使うので座標の厳密比較には使わず、「例外なく完了し座標が有限値」だけを検証
- SVG は文字列包含ではなく、構造（viewBox、要素数、座標）で検証する

## 呼び出し側の使用例（ライブラリには含めない）

```ts
// interactive-instruction-mcp 側に置くコード
// 「何を図示するか」の知識はここにだけある
const svg = await renderGraphSvg({
  graph: {
    nodes: docs.map((d) => ({ id: d.id, label: d.id, group: d.id.split("__")[0] })),
    edges: docs.flatMap((d) =>
      (d.relatedDocs ?? []).map((to) => ({ source: d.id, target: to, kind: "related" }))
    ),
  },
  layout: { name: "cose" },
});
```

