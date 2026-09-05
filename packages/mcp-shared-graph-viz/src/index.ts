/**
 * mcp-shared-graph-viz
 *
 * Give it nodes and edges, get an interactive page. Mapping a domain onto
 * nodes and edges stays with the caller; this library holds no domain
 * knowledge.
 *
 * The page runs cytoscape in the browser, which is where cytoscape can both
 * lay out and draw a graph, so this package has no runtime dependencies.
 */

export { renderHtml as renderGraphHtml } from "./html.js";
export { buildCytoscapeStyle, DEFAULT_CYTOSCAPE_URL, DEFAULT_DAGRE_URLS } from "./html.js";
export { toCytoscapeElements } from "./elements.js";
export { buildLayoutSpec } from "./layout-spec.js";
export { GraphVizError } from "./errors.js";
export { DEFAULT_PALETTE, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from "./theme.js";

export type { CytoscapeElement } from "./elements.js";
export type { LayoutSpec } from "./layout-spec.js";
export type {
  GraphEdge,
  GraphInput,
  GraphNode,
  LayoutDirection,
  LayoutName,
  LayoutOptions,
  NodeShape,
  Palette,
  Point,
  RenderGraphHtmlParams,
  Swatch,
  ThemeOptions,
} from "./types.js";
