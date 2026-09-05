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

export { renderHtml as renderGraphHtml } from "./renderers/html/index.js";
export {
  buildCytoscapeStyle,
  DEFAULT_CYTOSCAPE_URL,
  htmlRenderer,
  HtmlRenderer,
  MAX_LABEL_WIDTH_PX,
} from "./renderers/html/index.js";

export { toCytoscapeElements } from "./elements.js";
export { buildLayoutSpec, DEFAULT_LAYOUT, LAYOUTS, layoutNames, resolveLayout } from "./layouts/index.js";
export { GraphVizError } from "./errors.js";
export { DEFAULT_PALETTE, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from "./theme.js";

export type { CytoscapeElement } from "./elements.js";
export type { Layout, LayoutSpec } from "./layouts/index.js";
export type { Renderer, RenderParams } from "./renderers/types.js";
export type { HtmlRendererOptions } from "./renderers/html/index.js";
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
  Swatch,
  ThemeOptions,
} from "./types.js";
