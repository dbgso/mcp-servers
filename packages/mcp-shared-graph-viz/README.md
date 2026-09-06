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

Fifteen, and the shape of the data decides which one reads well.

| | Layout | Good for |
|---|---|---|
| **Layered** | `dagre` (default), `klay`, `elk-layered` | Anything with a direction: dependencies, chains, hierarchies |
| **Tree** | `elk-mrtree`, `breadthfirst` | Strict trees, levels from a root |
| **Force** | `fcose`, `cose`, `cola`, `elk-stress` | Loosely connected clusters, no inherent direction |
| **Circular** | `cise`, `avsdf`, `circle`, `concentric` | Showing membership; `cise` draws one circle per `group` |
| **Fixed** | `grid`, `preset` | A regular arrangement, or coordinates the caller already has |

`direction` (`TB` / `BT` / `LR` / `RL`) applies to `dagre`, `klay` and the ELK
layouts. `LR` is usually the readable choice for a graph that fans out.

Seven are built into cytoscape and cost nothing to load. The rest come from
extensions the page fetches from a CDN, pinned to exact versions; a layout
declares its own scripts and the globals they define, so nothing else has to
know.

`cose`, `fcose`, `cola` and `elk-stress` are randomised and differ between
runs. Use `preset`, `grid`, `dagre` or `klay` when the output has to be
reproducible.

ELK's `radial` is deliberately absent: it requires a tree, and given a cycle it
does not fail but spins, taking the page's main thread with it.

### Edge routing

```ts
renderGraphHtml({ graph, edgeStyle: "taxi" });
```

`bezier` (default), `taxi` (right-angled elbows), `segments`, `straight`,
`haystack`. `taxi` takes its direction from the layout's, so it is not asked
for twice.

### Options

```ts
renderGraphHtml({
  graph,
  layout: { name: "dagre", direction: "LR", spacing: 1.2 },
  theme: { palette, fontFamily, fontSize },
  title: "...",
  legend: true,
  edgeStyle: "taxi",         // how edges are drawn
  cytoscapeUrl: "...",       // where the page loads cytoscape from
  layoutScriptUrls: ["..."], // and whatever the layout needs
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
interface RenderParams {          // the whole of what a renderer is asked to draw
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

A renderer declares the format it produces and leaves matching to whoever holds
the renderers. Asking each renderer to decide instead would mean writing the
normalisation — case, surrounding space, aliases — once per renderer, with each
free to get it slightly wrong; declared as a name, it is one line of data and
the matching lives in one place.

A format's own settings are **not** arguments to `render` — they are bound when
the renderer is built, so every renderer answers the same signature and a
caller that does not know the format can still drive it:

```ts
class HtmlRenderer implements Renderer {
  readonly format = "html";
  constructor(private readonly options: HtmlRendererOptions = {}) {}
  render = (params: RenderParams): string => renderHtml({ ...params, ...this.options });
}
```

```ts
const renderers: Record<string, Renderer> = { html: htmlRenderer };
renderers[format].render({ graph, title });                  // nothing format-specific here

const offline = new HtmlRenderer({ cytoscapeUrl: "/vendor/cytoscape.js" });
offline.render({ graph });                                    // same call
```

What differs between formats is settled by the constructor; `render` is the
same call for every one of them. Putting `cytoscapeUrl` in the render params
instead would leave `Renderer` unusable through its own type, which is to say
not polymorphic at all.

`renderGraphHtml` still takes both, for callers that know they want HTML and
never go through a `Renderer`.

`TOutput` is a type parameter rather than `string` because that is the part
most likely to differ: a raster format returns bytes, and a renderer that has
to fetch a font or drive a browser returns a promise. Adding either widens the
type instead of breaking it.

`render` is a property rather than a method so TypeScript checks it
contravariantly — a renderer that quietly demanded more than `RenderParams`
is rejected instead of slipping through.

A test walks `renderers/*/` and asserts each directory's entry point exports a
`Renderer` named after the directory, so a second format cannot quietly arrive
as a bare function beside the seam instead of through it.

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

### One warning the page still prints

cytoscape prints `The style value of \`label\` is deprecated for \`width\`` (and
for `height`). Sizing a node to its label is what this package wants and
`nodeSize` accepts no other non-numeric value, so there is nothing to migrate
to; the page keeps it. Everything else cytoscape had to say has been dealt
with — the font stack it silently rejected, the label mapping it warned about
once per unlabelled edge, and the custom wheel sensitivity it advises against.

If you need a static image instead — for a Markdown embed, or a reply that
cannot run a browser — emit DOT or mermaid from the same nodes and edges and
hand it to `kroki-mcp`.
