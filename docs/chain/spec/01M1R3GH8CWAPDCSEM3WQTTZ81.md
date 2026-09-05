---
id: 01M1R3GH8CWAPDCSEM3WQTTZ81
type: spec
title: mcp-shared-graph-viz パッケージ仕様
requires: 01M1R3CHVZ5CNGQEDT57RQ4QSH
created: 2026-09-05T06:18:51.020Z
updated: 2026-09-05T06:18:51.020Z
---

# mcp-shared-graph-viz パッケージ仕様

要求「グラフ構造の図示を共通ライブラリ化」を、具体的なパッケージ・API の契約として規定する。

## パッケージ

- 名前: `mcp-shared-graph-viz`（既存の `mcp-shared-*` 命名に準拠）
- 配置: `packages/mcp-shared-graph-viz`
- ESM のみ。`main: dist/index.js` / `types: dist/index.d.ts`
- ランタイム依存は `cytoscape` と `cytoscape-dagre` のみ。canvas / puppeteer / ヘッドレスブラウザには依存しない

## 入力型（呼び出し側が作る）

```ts
interface GraphNode {
  id: string;                 // 一意。必須
  label?: string;             // 未指定なら id を表示
  group?: string;             // 色の自動割当キー（例: doc のカテゴリ、ノードの種別）
  parent?: string;            // コンパウンドノード（グルーピング枠）の親 id
  shape?: NodeShape;          // 'roundRect' | 'rect' | 'ellipse' | 'diamond'
  width?: number;             // 明示指定。未指定ならラベルから算出
  height?: number;
  href?: string;              // SVG/HTML でリンク化
  tooltip?: string;
  data?: Record<string, unknown>; // 呼び出し側の任意データ。ライブラリは中身を解釈しない
}

interface GraphEdge {
  source: string;             // GraphNode.id
  target: string;             // GraphNode.id
  id?: string;                // 未指定なら source/target から生成
  label?: string;
  kind?: string;              // 線種・色の割当キー（例: 'requires' | 'related'）
  directed?: boolean;         // 既定 true
  data?: Record<string, unknown>;
}

interface GraphInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

この型にはいかなる MCP サーバー固有の語彙も含めない（`relatedDocs` や `requires` は呼び出し側で `edges` に変換済みであること）。

## 公開 API

```ts
function layoutGraph(params: LayoutGraphParams): Promise<LaidOutGraph>;
function renderGraphSvg(params: RenderGraphSvgParams): Promise<string>;
function renderGraphHtml(params: RenderGraphHtmlParams): string;
function toCytoscapeElements(params: { graph: GraphInput }): CytoscapeElement[];
```

| API | 同期性 | 用途 |
|---|---|---|
| `layoutGraph` | async | 座標だけ欲しい場合（独自描画するケース） |
| `renderGraphSvg` | async | 静的 SVG。MCP レスポンスやファイル書き出し |
| `renderGraphHtml` | sync | cytoscape.js を埋め込んだインタラクティブ HTML。ブラウザで探索 |
| `toCytoscapeElements` | sync | エスケープハッチ。cytoscape を直接使いたい場合 |

`renderGraphHtml` が同期なのは、レイアウト計算をブラウザ側の cytoscape に任せるため。

## オプション

```ts
interface LayoutOptions {
  name?: LayoutName;          // 'dagre' | 'cose' | 'concentric' | 'grid' | 'circle' | 'breadthfirst' | 'preset'
  direction?: 'TB' | 'BT' | 'LR' | 'RL';  // dagre / breadthfirst 向け
  width?: number;             // レイアウト領域幅。既定 1200
  height?: number;            // 既定 800
  spacing?: number;           // ノード間隔係数
  seed?: number;              // 非決定的レイアウトの再現性確保
}

interface RenderOptions {
  padding?: number;           // 既定 24
  theme?: ThemeOptions;       // パレット・背景色・フォント
  title?: string;             // 図の見出し
  legend?: boolean;           // group 凡例を描画するか。既定 true（group が1種以上ある場合）
  measureLabel?: (params: { text: string; fontSize: number }) => number; // ラベル幅の差し替え
}
```

すべて任意。`renderGraphSvg({ graph })` だけで図が出ることを仕様とする（呼び出し側の設定負担をゼロにする）。

## 出力型

```ts
interface LaidOutNode { id; label; x; y; width; height; shape; group?; href?; ... }
interface LaidOutEdge { id; source; target; label?; kind?; directed; sourcePoint; targetPoint; }
interface LaidOutGraph {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  bounds: { x: number; y: number; width: number; height: number };
}
```

座標はすべてノード中心基準。`bounds` は padding 適用後の SVG viewBox に相当する。

## 振る舞い仕様

### 色の自動割当

`group` が指定されたノードは、**group 名の出現順**でパレットから色を割り当てる。同じ入力に対して常に同じ色になる（決定的）。group 数がパレット長を超えたら循環する。

### ラベル幅

canvas がないため実測できない。文字幅ヒューリスティックで概算する。全角文字（CJK）を 1.0em、半角を 0.6em 相当として扱う。`measureLabel` で差し替え可能。

### 長いラベル

最大幅を超えるラベルは複数行に折り返す。行数上限を超えたら末尾を省略記号にする。

### エッジ

- ノード境界でクリップし、中心ではなく外周から描画する
- `directed: true` なら矢印を付ける
- 自己ループ（source === target）はノード上部の弧として描画する
- 同じノード対を結ぶエッジが複数ある場合は曲率をつけて重なりを避ける

### エスケープ

ラベル・tooltipセhref は XML/HTML エスケープする。HTML 出力に埋め込むグラフ JSON は `</script>` を無害化する。

## エラー仕様

| 条件 | 振る舞い |
|---|---|
| `nodes` が空 | 空の図（有効な SVG）を返す。例外にしない |
| ノード id の重複 | 例外を投げる（重複 id をメッセージに含める） |
| 存在しないノードを指すエッジ | 例外を投げる（どの edge のどちらの端かをメッセージに含める） |
| 未知のレイアウト名 | 例外を投げる（利用可能な名前をメッセージに含める） |

入力不整合は呼び出し側のバグであり、黙って図を歪ませるより失敗させる。

## 非目標

- **PNG / ラスタ出力**: canvas / puppeteer 依存が重い。既存の kroki-mcp / python-diagrams-mcp の責務とする
- **ドメイン固有の変換器**: `relatedDocs → edges` のような変換は呼び出し側に置く
- **MCP ツール化**: 本パッケージはライブラリであり MCP サーバーではない
- **ファイル書き出し**: 文字列を返すまでが責務。数百ノード規模で SVG が巨大化する場合のファイル出力は呼び出し側の判断

## 品質要件

- テストカバレッジはプロジェクト規定の 95% 以上（`coding-rules__test-coverage`）
- テストは決定的レイアウト（grid / dagre / preset）で行う。`cose` は乱数を使うためスナップショットに使わない
- 生成される SVG は単体でブラウザ・画像ビューア・Markdown 埋め込みのいずれでも表示できる（外部参照ゼロ、フォントはシステムフォントスタック）

