import { clustersOf, prepareGraph, preparedToElements, presetPositions } from "../../elements.js";
import { assertPositions } from "../../errors.js";
import { buildLayoutSpec, resolveLayout } from "../../layouts/index.js";
import { resolveTheme } from "../../theme.js";
import { buildDocument } from "./document.js";
import { buildCytoscapeStyle } from "./style.js";
import type { Renderer } from "../types.js";
import type { HtmlRendererOptions } from "./types.js";
import type { RenderParams } from "../types.js";

export const DEFAULT_CYTOSCAPE_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.34.2/cytoscape.min.js";

/**
 * An interactive page: pan, zoom, hover to isolate a node's neighbourhood, and
 * click through on nodes that carry an href.
 *
 * Synchronous because the layout runs in the browser's cytoscape; this
 * function only assembles the document.
 */
export function renderHtml(params: RenderParams & HtmlRendererOptions): string {
  const {
    graph,
    layout: layoutOptions,
    theme,
    title,
    legend = true,
    edgeStyle,
    cytoscapeUrl = DEFAULT_CYTOSCAPE_URL,
    layoutScriptUrls,
  } = params;

  const prepared = prepareGraph({ graph, theme });
  const resolvedTheme = resolveTheme({ theme });
  const layout = resolveLayout({ name: layoutOptions?.name });

  if (layout.requiresPositions) {
    assertPositions({ layoutName: layout.name, nodes: prepared.nodes });
  }

  return buildDocument({
    title,
    theme: resolvedTheme,
    legend: legend
      ? prepared.groups.map((group) => ({
          name: group.name,
          fill: group.swatch.fill,
          stroke: group.swatch.stroke,
        }))
      : [],
    // The layout says which scripts it needs; the renderer does not know.
    scriptUrls: [cytoscapeUrl, ...(layoutScriptUrls ?? layout.scriptUrls)],
    elements: preparedToElements({ prepared }),
    style: buildCytoscapeStyle({
      prepared,
      theme: resolvedTheme,
      edgeStyle,
      direction: layoutOptions?.direction,
    }),
    layout: buildLayoutSpec({
      layout: layoutOptions,
      positions: presetPositions({ prepared }),
      clusters: clustersOf({ prepared }),
    }),
  });
}

/**
 * The page as a renderer.
 *
 * What differs between formats is settled by the constructor; `render` is the
 * same call for every one of them. That split is the whole reason a caller can
 * hold a `Renderer` without knowing which format it has.
 *
 * `render` is an arrow property, not a method: TypeScript checks method
 * parameters bivariantly, so a renderer quietly demanding more than
 * `RenderParams` would slip into a `Record<string, Renderer>` unnoticed.
 */
export class HtmlRenderer implements Renderer {
  readonly format = "html";

  constructor(private readonly options: HtmlRendererOptions = {}) {}

  render = (params: RenderParams): string => renderHtml({ ...params, ...this.options });
}

/** The page with default settings. */
export const htmlRenderer: Renderer = new HtmlRenderer();

export { buildCytoscapeStyle, DEFAULT_EDGE_STYLE, MAX_LABEL_WIDTH_PX } from "./style.js";
export { escapeScriptJson, escapeXml } from "./escape.js";
export type { HtmlRendererOptions } from "./types.js";
