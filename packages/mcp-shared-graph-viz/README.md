# mcp-shared-graph-viz

Give it nodes and edges, get a diagram.

## Responsibility split

This is the whole point of the package:

| | Responsibility |
|---|---|
| **Caller** (an MCP server) | Map its own domain onto nodes and edges |
| **This library** | Take nodes and edges, lay them out, draw them |

The library holds no domain knowledge. It has never heard of `relatedDocs`,
`requires`, or import graphs — those mappings belong to the caller.

```ts
// interactive-instruction-mcp: documents linked by relatedDocs
const svg = await renderGraphSvg({
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
const svg = await renderGraphSvg({
  graph: {
    nodes: documents.map((d) => ({ id: d.id, label: d.title, group: d.type })),
    edges: documents
      .filter((d) => d.requires !== undefined)
      .map((d) => ({ source: d.requires!, target: d.id, kind: "requires" })),
  },
  layout: { name: "dagre", direction: "LR" },
});
```

## API

```ts
renderGraphSvg(params): Promise<string>    // self-contained SVG
renderGraphHtml(params): string            // interactive page (cytoscape in the browser)
layoutGraph(params): Promise<LaidOutGraph> // coordinates only, draw them yourself
toCytoscapeElements(params): CytoscapeElement[]  // escape hatch
```

Everything except `graph` is optional. `renderGraphSvg({ graph })` produces a
diagram with no further configuration.

### Input

```ts
interface GraphNode {
  id: string;
  label?: string;      // defaults to id
  group?: string;      // drives color assignment and the legend
  parent?: string;     // compound (container) node
  shape?: "roundRect" | "rect" | "ellipse" | "diamond";
  width?: number;      // derived from the label when omitted
  height?: number;
  href?: string;       // makes the node a link
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

`cose` is randomized, so its output differs between runs. Use `preset`, `grid`
or `dagre` when you need reproducible output.

### Options

```ts
renderGraphSvg({
  graph,
  layout: { name: "dagre", direction: "LR", spacing: 1.2 },
  theme: { palette, fontFamily, fontSize, drawBackground },
  padding: 24,
  title: "...",
  legend: true,
  measureLabel: ({ text, fontSize }) => realFontMetrics(text, fontSize),
});
```

## Errors

An inconsistent graph is a bug in the caller's mapping, so it throws
`GraphVizError` rather than silently drawing something skewed:

- duplicate node ids
- edges pointing at nodes that do not exist
- `parent` pointing at a node that does not exist
- an unknown layout name
- the `preset` layout with nodes that have no `position`

An empty graph is not an error; it renders as an empty diagram.

## How it works, and why

cytoscape is a browser library: its **rendering** needs a canvas and does not
work headless. Its **layout** engines do. So this package uses cytoscape purely
as a layout engine and generates the SVG itself.

```
GraphInput ──▶ cytoscape (headless) ──▶ LaidOutGraph ──▶ SVG written here
                 coordinates only
```

The consequence is that the only runtime dependencies are `cytoscape` and
`cytoscape-dagre`. No canvas, no puppeteer, no headless browser.

### Headless pitfalls this package absorbs

These are the reason a shared library is worth having; callers never see them.

| Pitfall | What happens | Handled by |
|---|---|---|
| `cy.width()`/`cy.height()` are 0 headless | `breadthfirst` produces coordinates around `1e49` | An explicit `boundingBox` for area-based layouts |
| cytoscape rescales results into `boundingBox` | Passing one to `dagre`/`cose` overrides their spacing and nodes overlap | `boundingBox` only for layouts that need it |
| Element `position` is ignored headless | `preset` silently stacks everything at the origin | Positions passed to the layout explicitly |
| The cytoscape instance holds handles | The Node process never exits | `cy.destroy()` in a `finally` |
| No canvas means no text metrics | Node sizes cannot be measured | Per-code-point width estimation, overridable via `measureLabel` |

### Label sizing

Width is estimated per code point: full-width (CJK) characters count as 1.0em,
ordinary latin 0.58em, narrow glyphs 0.32em. Labels wrap at word boundaries
(per character for CJK) and elide with `…` past three lines. Pass
`measureLabel` to substitute real font metrics, or set `width`/`height` on a
node to bypass estimation entirely.

## Output

`renderGraphSvg` returns a self-contained SVG: no external references, no
scripts, system font stack. It displays in a browser, an image viewer, or
embedded in Markdown.

Writing it to a file is the caller's decision — a several-hundred-node graph
produces an SVG too large for an MCP response.
