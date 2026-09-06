---
id: 01M1R3GH8CWAPDCSEM3WQTTZ81
type: spec
title: mcp-shared-graph-viz パッケージ仕様
requires: 01M1R3CHVZ5CNGQEDT57RQ4QSH
created: 2026-09-05T06:18:51.020Z
updated: 2026-09-05T10:52:56.636Z
---

# mcp-shared-graph-viz パッケージ仕様

要求「グラフ構造の図示を共通ライブラリ化」を、具体的なパッケージ・API の契約として規定する。

## パッケージ

- 名前: `mcp-shared-graph-viz`（既存の `mcp-shared-*` 命名に準拠）
- 配置: `packages/mcp-shared-graph-viz`
- ESM のみ。`main: dist/index.js` / `types: dist/index.d.ts`
- monorepo 内部の shared lib なので `private: true`
- **ランタイム依存なし**。cytoscape は生成したページがブラウザで読み込む

## 出力形式

**インタラクティブ HTML のみ。**

初期要件は「人間がグラフィカルに見たい」であり、それを満たす最短の形がブラウザで開けるページである。静的画像（SVG / PNG）は非目標とする（後述）。

## 入力型（呼び出し側が作る）

```ts
interface GraphNode {
  id: string;                 // 一意。必須
  label?: string;             // 未指定なら id を表示
  group?: string;             // 色の自動割当キー、凡例の項目
  parent?: string;            // コンパウンドノード（グルーピング枠）の親 id
  shape?: NodeShape;          // 'roundRect' | 'rect' | 'ellipse' | 'diamond'
  width?: number;             // 明示指定。未指定ならブラウザがラベルから決める
  height?: number;
  href?: string;              // クリックで開く
  tooltip?: string;           // ホバー中に表示
  position?: Point;           // preset レイアウト用
  data?: Record<string, unknown>; // 呼び出し側の任意データ。ライブラリは解釈しない
}

interface GraphEdge {
  source: string;
  target: string;
  id?: string;                // 未指定なら source/target から生成
  label?: string;
  kind?: string;              // 分類キー。element data に載るだけ
  directed?: boolean;         // 既定 true
  data?: Record<string, unknown>;
}

interface GraphInput { nodes: GraphNode[]; edges: GraphEdge[]; }
```

この型にはいかなる MCP サーバー固有の語彙も含めない（`relatedDocs` や `requires` は呼び出し側で `edges` に変換済みであること）。

## 公開 API

```ts
function renderGraphHtml(params: RenderGraphHtmlParams): string;
function toCytoscapeElements(params: { graph: GraphInput; theme?: ThemeOptions }): CytoscapeElement[];
function buildLayoutSpec(params: { layout?: LayoutOptions; presetPositions?: Map<string, Point> }): LayoutSpec;
```

| API | 用途 |
|---|---|
| `renderGraphHtml` | ページ本体。文字列を返すので、書き出し先は呼び出し側の判断 |
| `toCytoscapeElements` | エスケープハッチ。cytoscape を自前で駆動したい場合 |
| `buildLayoutSpec` | 同上。レイアウト設定だけ欲しい場合 |

いずれも同期関数。レイアウト計算はブラウザ側の cytoscape が行うため、Node 側に非同期処理がない。

## オプション

```ts
interface LayoutOptions {
  name?: LayoutName;          // 'dagre'(既定) | 'cose' | 'concentric' | 'grid' | 'circle' | 'breadthfirst' | 'preset'
  direction?: 'TB' | 'BT' | 'LR' | 'RL';  // 階層レイアウト向け
  spacing?: number;           // ノード間隔の係数。既定 1
}

interface ThemeOptions {
  palette?: Palette;
  fontFamily?: string;
  fontSize?: number;
}

interface RenderGraphHtmlParams {
  graph: GraphInput;
  layout?: LayoutOptions;
  theme?: ThemeOptions;
  title?: string;             // 見出し
  legend?: boolean;           // group 凡例。既定 true
  cytoscapeUrl?: string;      // ページが cytoscape を読む先
  layoutScriptUrls?: string[];// レイアウトが必要とするスクリプトの差し替え
}
```

`graph` 以外すべて任意。`renderGraphHtml({ graph })` だけでページが出ることを仕様とする。

## ページの振る舞い

- パン・ズーム
- ノードをホバーすると、そのノードと直接の隣接以外を淡色化する
- ホバー中は `tooltip`（未指定ならラベル）を隅に表示する
- `href` を持つノードはクリックで別タブに開く（`noopener`）
- `group` があれば凡例を出す
- `window.graphViz.cy` で cytoscape インスタンスを公開する。ページを行き止まりにしない

## 色の自動割当

`group` が指定されたノードは、**group 名の出現順**でパレットから色を割り当てる。同じ入力に対して常に同じ色になる（決定的）。group 数がパレット長を超えたら循環する。

## エラー仕様

| 条件 | 振る舞い |
|---|---|
| `nodes` が空 | 空のページを返す。例外にしない |
| ノード id の重複 | 例外（重複 id をメッセージに含める） |
| 存在しないノードを指すエッジ | 例外（どの edge のどちらの端かをメッセージに含める） |
| 存在しない親を指す `parent` | 例外 |
| 未知のレイアウト名 | 例外（利用可能な名前をメッセージに含める） |
| `preset` なのに座標のないノードがある | 例外。放置すると全ノードが原点に重なる |

入力不整合は呼び出し側のバグであり、黙って誤解を招く図を出すより失敗させる。

## エスケープ

ラベル・tooltip・href・タイトル・スクリプト URL は HTML エスケープする。埋め込むグラフ JSON は `</script>` と行区切り文字を無害化する。

## 非目標

- **静的画像（SVG / PNG）**: 初期要件は「人間がグラフィカルに見たい」であり、ブラウザで開けるページで足りる。Markdown 埋め込みなど静的画像が要る場合は、同じ nodes/edges から DOT や mermaid を吐いて既存の `kroki-mcp` に渡す方が、描画の自前実装より安い
- **ドメイン固有の変換器**: `relatedDocs → edges` のような変換は呼び出し側に置く
- **MCP ツール化**: 本パッケージはライブラリであり MCP サーバーではない
- **ファイル書き出し**: 文字列を返すまでが責務

## 品質要件

- テストカバレッジはプロジェクト規定の 95% 以上（`coding-rules__test-coverage`）
- 生成した HTML は実ブラウザで動作確認すること。文字列の一致だけでは、ページが実際に描画されるかは分からない
