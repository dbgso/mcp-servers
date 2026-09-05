import { prepareGraph, preparedToElements, presetPositions } from "../../elements.js";
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
    style: buildCytoscapeStyle({ prepared, theme: resolvedTheme }),
    layout: buildLayoutSpec({
      layout: layoutOptions,
      positions: presetPositions({ prepared }),
    }),
  });
}

/**
 * The page as a renderer.
 *
 * Its settings are bound here, the way `ssmSource({ region })` binds a secret
 * source's, so `render` takes nothing but the shared `RenderParams`.
 */
export function createHtmlRenderer(options: HtmlRendererOptions = {}): Renderer {
  return {
    format: "html",
    render: (params) => renderHtml({ ...params, ...options }),
  };
}

/** The page with default settings. */
export const htmlRenderer: Renderer = createHtmlRenderer();

export { buildCytoscapeStyle, MAX_LABEL_WIDTH_PX } from "./style.js";
export { escapeScriptJson, escapeXml } from "./escape.js";
export type { HtmlRendererOptions } from "./types.js";
