# mcp-shared-graph-viz

Give it nodes and edges, get a page a human can look at.

## Responsibility split

This is the whole point of the package:

| | Responsibility |
|---|---|
| **Caller** (an MCP server) | Map its own domain onto nodes and edges |
| **This library** | Turn nodes and edges into an interactive page |

The library holds no domain knowledge. It has never heard of `relatedDocs`,
`requires`, or import graphs — those mappings belong to the caller.

```ts
// interactive-instruction-mcp: documents linked by relatedDocs
const html = renderGraphHtml({
  graph: {
    nodes: docs.map((doc) => ({ id: doc.id, label: doc.id, group: doc.category })),
    edges: docs.flatMap((doc) =>
      (doc.relatedDocs ?? []).map((to) => ({ source: doc.id, target: to })),
    ),
  },
  title: "Topic relations",
});
```

```ts
// traceable-chain-mcp: requirement -> spec -> design -> adr
const html = renderGraphHtml({
  graph: {
    nodes: documents.map((d) => ({
      id: d.id,
      label: d.title,
      group: d.type,
      tooltip: `${d.type}: ${d.id}`,
      href: urlFor(d),
    })),
    edges: documents
      .filter((d) => d.requires !== undefined)
      .map((d) => ({ source: d.requires!, target: d.id })),
  },
  layout: { name: "dagre", direction: "LR" },
});
```

Write the string to a file and open it.

## API

```ts
renderGraphHtml(params): string                  // the page
toCytoscapeElements(params): CytoscapeElement[]  // elements only, drive cytoscape yourself
buildLayoutSpec(params): LayoutSpec              // the layout config the page embeds
```

Everything except `graph` is optional. `renderGraphHtml({ graph })` produces a
page with no further configuration.

### The page

- pan and zoom
- hovering a node dims everything outside its immediate neighbourhood
- a node's `tooltip` (or its label) appears in a corner while hovered
- a node with an `href` opens it on click
- a legend of the groups, when any node is grouped
- `window.graphViz.cy` exposes the cytoscape instance, so the page is a
  starting point rather than a dead end

### Input

```ts
interface GraphNode {
  id: string;
  label?: string;      // defaults to id
  group?: string;      // drives color assignment and the legend
  parent?: string;     // compound (container) node
  shape?: "roundRect" | "rect" | "ellipse" | "diamond";
  width?: number;      // sized from the label by the browser when omitted
  height?: number;
  href?: string;       // clicking the node opens this
  tooltip?: string;
  position?: { x: number; y: number };  // for the "preset" layout
  data?: Record<string, unknown>;       // never interpreted
}

interface GraphEdge {
  source: string;
  target: string;
  id?: string;
  label?: string;
  kind?: string;
  directed?: boolean;  // defaults to true
  data?: Record<string, unknown>;
}
```

### Layouts

`dagre` (default), `cose`, `concentric`, `grid`, `circle`, `breadthfirst`, `preset`.

| Shape of data | Layout |
|---|---|
| Dependency chains, hierarchies | `dagre` (with `direction: "LR"` for wide graphs) |
| Loosely connected clusters | `cose` |
| Caller already has coordinates | `preset` (every node needs `position`) |

### Options

```ts
renderGraphHtml({
  graph,
  layout: { name: "dagre", direction: "LR", spacing: 1.2 },
  theme: { palette, fontFamily, fontSize },
  title: "...",
  legend: true,
  cytoscapeUrl: "...",       // where the page loads cytoscape from
  layoutScriptUrls: ["..."], // and whatever the layout needs (only dagre does)
});
```

## Layout of the source

```
src/
  types.ts        input types, free of domain vocabulary
  errors.ts       validation
  theme.ts        palette, group -> color
  elements.ts     GraphInput -> cytoscape elements
  layouts/        one module per layout, plus the registry
  renderers/
    html/         one output format: the page
```

A layout's quirks live in its own module and reach the rest of the package
through the `Layout` interface:

```ts
interface Layout {
  readonly name: LayoutName;
  readonly scriptUrls: readonly string[];   // dagre needs two, the rest none
  readonly requiresPositions: boolean;      // only preset does
  buildSpec(params: BuildSpecParams): Record<string, unknown>;
}
```

Adding a layout means adding a file under `layouts/` and one entry in the
registry. Nothing else branches on the layout name — a test asserts that, by
searching the sources outside `layouts/` for comparisons against a layout name.

The registry is typed as a total map over `LayoutName`, so adding a name to the
union without adding its layout is a compile error.

`renderers/html/` is one output format, and it says so in the type:

```ts
interface RenderParams {                 // what every renderer needs
  graph: GraphInput;
  layout?: LayoutOptions;
  theme?: ThemeOptions;
  title?: string;
  legend?: boolean;
}

interface Renderer<TParams extends RenderParams = RenderParams, TOutput = string> {
  readonly format: string;
  render(params: TParams): TOutput;
}

export const htmlRenderer: Renderer<RenderGraphHtmlParams> = {
  format: "html",
  render: renderHtml,
};
```

`TOutput` is a type parameter rather than `string` because that is the part
most likely to differ: a raster format returns bytes, and a renderer that has
to fetch a font or drive a browser returns a promise. Adding either widens the
type instead of breaking it.

Splitting `RenderParams` out is worth it even with one renderer: it keeps what
every format needs visibly apart from what the page alone needs
(`cytoscapeUrl`, `layoutScriptUrls`).

A test walks `renderers/*/` and asserts each directory's entry point exports a
`Renderer`, so a second format cannot quietly arrive as a bare function beside
the seam instead of through it.

## Errors

An inconsistent graph is a bug in the caller's mapping, so it throws
`GraphVizError` rather than silently drawing something misleading:

- duplicate node ids
- edges pointing at nodes that do not exist
- `parent` pointing at a node that does not exist
- an unknown layout name
- the `preset` layout with nodes that have no `position`

An empty graph is not an error; it renders as an empty page.

## Why the layout runs in the browser

cytoscape can lay out a graph headless, but its **rendering needs a canvas**,
which headless Node does not have. Doing half the work here would mean
computing coordinates in Node and drawing them by hand — and paying for it:
without a canvas there is no way to measure text, so node sizes would have to
be guessed from the label.

Running the whole thing in the browser avoids all of that. cytoscape lays out
*and* draws, and it measures the text itself. This package assembles the page:
elements, styles, colors, the layout spec, and the interactions.

The consequence is that it has **no runtime dependencies**. cytoscape is loaded
by the page from a CDN, pinned to an exact version and overridable via
`cytoscapeUrl` / `dagreUrls` for an offline or self-hosted copy.

If you need a static image instead — for a Markdown embed, or a reply that
cannot run a browser — emit DOT or mermaid from the same nodes and edges and
hand it to `kroki-mcp`.
