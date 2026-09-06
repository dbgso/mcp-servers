---
id: 01M1R3THBV476397KVN4VAF6BW
type: design
title: mcp-shared-graph-viz 実装設計
requires: 01M1R3GH8CWAPDCSEM3WQTTZ81
created: 2026-09-05T06:24:18.811Z
updated: 2026-09-06T06:16:21.329Z
---

# mcp-shared-graph-viz 実装設計

仕様「mcp-shared-graph-viz パッケージ仕様」をどう実装するか。

## 最重要の設計判断: レイアウトも描画もブラウザで行う

cytoscape は headless でも**レイアウト計算はできる**。しかし**描画は canvas に依存する**ため headless では動かない。

そこで取りうる形は2つあった。

| 案 | 内容 | 代償 |
|---|---|---|
| A: 半分だけ Node で | headless でレイアウト → 座標を得て SVG を自前生成 | 描画コードを全部自前で持つ。さらに canvas がないので**文字幅を測れず**、ノードサイズをラベルから推定するしかない |
| B: 全部ブラウザで | elements / style / レイアウト設定を組み立てて HTML に埋め込む | ページを開くのにブラウザが要る |

**B を採る。** 初期要件が「人間がグラフィカルに見たい」である以上、ブラウザで開くことは前提であり、A の代償を払う理由がない。

結果として、このパッケージは cytoscape に**ランタイム依存しない**。ページが CDN から読む。

```
GraphInput ──▶ prepareGraph ──▶ elements / style / layout spec ──▶ HTML
                （検証・色・ラベル）                                    │
                                                                       ▼
                                                     ブラウザの cytoscape がレイアウトと描画
```

### ノードサイズはブラウザに任せる

cytoscape の `width: 'label'` / `height: 'label'` と `padding` を使う。ブラウザは実際のフォントでテキストを測れるので、日本語混在でも破綻しない。`GraphNode.width` / `height` が指定された場合のみ `node[width]` / `node[height]` セレクタで上書きする。

### preset レイアウトは座標を明示的に渡す

要素定義の `position` は読み戻されないことがあるため、`positions` オプションでレイアウトに直接渡す。座標を持たないノードがあるまま `preset` を選ぶと全ノードが原点に重なるので、その場合は `GraphVizError` で落とす。

## ファイル構成

```
src/
  types.ts              入力型・オプション型（ドメイン語彙ゼロ）  [型のみ]
  errors.ts             入力検証と GraphVizError                  [pure]
  theme.ts              パレット、group → 色の決定的割当           [pure]
  elements.ts           GraphInput → cytoscape elements           [pure]
  layouts/              レイアウト1つにつき1モジュール + レジストリ
    types.ts            Layout インターフェース
    registry.ts         name → Layout。名前一覧の唯一の出所
    dagre.ts / cose.ts / concentric.ts / breadthfirst.ts
    geometric.ts        grid / circle（形だけで決まる。名前をコンストラクタで受ける）
    preset.ts
  renderers/            出力形式1つにつき1ディレクトリ
    html/
      index.ts          renderHtml
      style.ts          cytoscape スタイルシート
      document.ts       ページのテンプレート
      escape.ts         HTML / script JSON エスケープ
  index.ts              公開 API
```

**全モジュールが pure。** 副作用も非同期もない。入出力の assert だけでテストできる。

`renderers/html` は**出力形式の1つ**であり、それを型で表明する。

```ts
interface RenderParams {          // レンダラに描かせるものの全て
  graph: GraphInput;
  layout?: LayoutOptions;
  theme?: ThemeOptions;
  title?: string;
  legend?: boolean;
}

interface Renderer<TOutput = string> {
  readonly format: string;
  render: (params: RenderParams) => TOutput;
}
```

レンダラは produce する形式を**名前として宣言するだけ**にし、照合はレンダラ群を保持する側に置く。レンダラ自身に判定させると、正規化（大小文字・前後の空白・別名）を実装ごとに書くことになり、**N個それぞれで間違えられる**。宣言ならデータ1行で、照合は1箇所。

**形式固有の設定は `render` の引数にしない。** 構築時に束縛する。

```ts
class HtmlRenderer implements Renderer {
  readonly format = "html";
  constructor(private readonly options: HtmlRendererOptions = {}) {}
  render = (params: RenderParams): string => renderHtml({ ...params, ...this.options });
}

const offline = new HtmlRenderer({ cytoscapeUrl: "/vendor/cytoscape.js" });
offline.render({ graph });        // 呼び出しは共通のまま
```

**形式ごとに違う部分はコンストラクタで決め、`render` はどの形式でも同じ呼び出しにする。** 固有設定を render の引数に混ぜると、形式を知らない呼び出し側が `Renderer` 型のまま呼べなくなり、**多態が成立しない**。

実装はクラスで与える（`coding-rules__polymorphism` の Good Example に倣う）。コンストラクタが「違いを吸収する場所」として構文上はっきりするため。

- `TOutput` を型引数にしているのは、戻り値が最も変わりやすいため（ラスタはバイト列、フォント取得やブラウザ起動を伴うものは Promise）
- `render` をメソッドではなくプロパティ構文で宣言しているのは、TypeScript の反変チェックを効かせるため。メソッド構文は双変なので、`RenderParams` より多くを要求するレンダラが素通りする（実測確認済み）

**レジストリは置かない。** `Dialect` と同様、利用側が1つ選んで使うだけで、複数を同時に扱う必要がないため。

## レイアウトの多態化

レイアウトごとの差異は if 連鎖ではなく `Layout` インターフェースの実装に持たせる（`coding-rules__polymorphism`）。

```ts
interface Layout {
  readonly name: LayoutName;
  readonly scriptUrls: readonly string[];   // dagre だけ2本、他はゼロ
  readonly requiresPositions: boolean;      // preset だけ true
  buildSpec(params: BuildSpecParams): Record<string, unknown>;
}

class DagreLayout implements Layout { ... }
class GeometricLayout implements Layout {  // grid / circle
  constructor(readonly name: LayoutName) {}
}
```

実装はクラスで与える（`coding-rules__polymorphism`）。`GeometricLayout` のように「名前だけが違う」ものは、その違いをコンストラクタが受ける。

レイアウトを追加する作業は「`layouts/` にファイルを1つ足し、レジストリに1行足す」で閉じる。呼び出し側の変更は不要。

- レジストリを `Record<LayoutName, Layout>` として型付けするので、`LayoutName` に名前を足して実装を忘れると**コンパイルエラー**になる
- 「dagre のときだけスクリプトを読む」という知識も `Layout.scriptUrls` に持たせ、レンダラは名前を見ない
- 「preset は座標が要る」も `Layout.requiresPositions` に持たせる
- `layouts/` の外でレイアウト名と比較していないことを**テストで機械的に検査する**

## 主要アルゴリズム

### 色の決定的割当（theme.ts）

`group` 名を**ノード配列での初出順**に並べ、その index でパレットを引く。ハッシュではなく出現順にする理由は、少数の group でも確実に色が分かれ（衝突しない）、かつ同じ入力に対して常に同じ結果になるため。

パレットは背景（淡色）と線（濃色）のペアで持ち、ラベルの可読性を確保する。

### スタイルの組み立て（html.ts）

ベースの `node` / `edge` ルールに加えて、ノードごとに1ルールを出して group の色と形を当てる。矢印は `edge[?directed]` セレクタで有向エッジにのみ付ける。

### インタラクション

- `mouseover`/`mouseout` で `closedNeighborhood()` 以外に `.faded` クラスを付け外しする
- `tap` で `href` を別タブに開く（`noopener`）
- `window.graphViz = { cy }` を公開する

### エスケープ（escape.ts）

- HTML に直接入る文字列（ラベル、タイトル、URL）は XML エスケープ
- `<script>` に埋め込む JSON は `<` `>` と U+2028/U+2029 をエスケープし、`</script>` でタグが閉じないようにする

## テスト方針

- pure 関数は `it.each` + 型付きテストデータ変数（`coding-rules__typescript`）
- HTML は「文字列に含まれるか」ではなく、**埋め込んだ JSON をパースして構造で**検証する
- **文字列テストだけでは足りない。** 生成したページを実ブラウザで開き、描画とインタラクションを確認する（CDP でホバー・クリックを実際に発火させる）

## 呼び出し側の使用例（ライブラリには含めない）

```ts
// interactive-instruction-mcp 側に置くコード
// 「何を図示するか」の知識はここにだけある
const html = renderGraphHtml({
  graph: {
    nodes: docs.map((d) => ({ id: d.id, label: d.id, group: d.id.split("__")[0] })),
    edges: docs.flatMap((d) =>
      (d.relatedDocs ?? []).map((to) => ({ source: d.id, target: to, kind: "related" }))
    ),
  },
  layout: { name: "cose" },
});
```
