import { layoutGraph } from "./layout.js";
import { renderSvg } from "./svg/render.js";
import type { LaidOutGraph, RenderGraphSvgParams } from "./types.js";

/**
 * mcp-shared-graph-viz
 *
 * Give it nodes and edges, get a diagram. Mapping a domain onto nodes and
 * edges stays with the caller; this library holds no domain knowledge.
 */

/** Lay out and render a graph as a self-contained SVG document. */
export async function renderGraphSvg(params: RenderGraphSvgParams): Promise<string> {
  const graph: LaidOutGraph = await layoutGraph({
    graph: params.graph,
    layout: params.layout,
    theme: params.theme,
    measureLabel: params.measureLabel,
  });

  return renderSvg({
    graph,
    padding: params.padding,
    theme: params.theme,
    title: params.title,
    legend: params.legend,
    measureLabel: params.measureLabel,
  });
}

export { layoutGraph } from "./layout.js";
export { renderHtml as renderGraphHtml } from "./html.js";
export { toCytoscapeElements } from "./elements.js";
export { renderSvg } from "./svg/render.js";

export { GraphVizError } from "./errors.js";
export { DEFAULT_PALETTE, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from "./theme.js";
export { estimateTextWidth } from "./measure.js";

export type { CytoscapeElement } from "./elements.js";
export type {
  Bounds,
  GraphEdge,
  GraphInput,
  GraphNode,
  LaidOutEdge,
  LaidOutGraph,
  LaidOutNode,
  LayoutDirection,
  LayoutGraphParams,
  LayoutName,
  LayoutOptions,
  MeasureLabel,
  NodeShape,
  Palette,
  Point,
  RenderGraphHtmlParams,
  RenderGraphSvgParams,
  RenderOptions,
  Swatch,
  ThemeOptions,
} from "./types.js";
