import { prepareGraph, preparedToElements } from "./elements.js";
import { buildLayoutSpec } from "./layout.js";
import { resolveTheme } from "./theme.js";
import { escapeScriptJson, escapeXml } from "./svg/escape.js";
import type { PreparedGraph } from "./elements.js";
import type { LayoutOptions, RenderGraphHtmlParams } from "./types.js";

export const DEFAULT_CYTOSCAPE_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.34.2/cytoscape.min.js";
export const DEFAULT_DAGRE_URLS = [
  "https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js",
  "https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.min.js",
];

/** cytoscape style sheet derived from the resolved theme and node swatches. */
export function buildCytoscapeStyle(params: { prepared: PreparedGraph }): unknown[] {
  const { prepared } = params;

  const perNode = prepared.nodes.map((node) => ({
    selector: `node[id = ${JSON.stringify(node.id)}]`,
    style: {
      "background-color": node.swatch.fill,
      "border-color": node.swatch.stroke,
      color: node.swatch.text,
    },
  }));

  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        width: "data(width)",
        height: "data(height)",
        shape: "round-rectangle",
        "border-width": 1.5,
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        "text-max-width": "170px",
        "font-size": 13,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.4,
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "line-color": "#8a94a3",
        "target-arrow-color": "#8a94a3",
        "arrow-scale": 0.9,
      },
    },
    ...perNode,
  ];
}

/**
 * The layout spec adjusted for the browser.
 *
 * In a browser cytoscape can measure its own container, so it should fit to
 * that; the headless bounding box would override the result instead.
 */
export function toBrowserLayoutSpec(params: { layout?: LayoutOptions }): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    ...buildLayoutSpec({ layout: params.layout }),
    fit: true,
    padding: 30,
  };
  delete spec.boundingBox;
  return spec;
}

/**
 * An interactive page.
 *
 * Synchronous because the layout runs in the browser's cytoscape rather than
 * here; this function only assembles the document.
 */
export function renderHtml(params: RenderGraphHtmlParams): string {
  const { graph, layout, theme, title, cytoscapeUrl = DEFAULT_CYTOSCAPE_URL } = params;
  const prepared = prepareGraph({ graph, theme });
  const resolvedTheme = resolveTheme({ theme });
  const elements = preparedToElements({ prepared });
  const layoutSpec = toBrowserLayoutSpec({ layout });

  const needsDagre = layoutSpec.name === "dagre";
  const dagreScripts = needsDagre
    ? DEFAULT_DAGRE_URLS.map((url) => `<script src="${escapeXml({ text: url })}"></script>`).join("")
    : "";

  const heading =
    title === undefined
      ? ""
      : `<h1>${escapeXml({ text: title })}</h1>`;

  const legend = prepared.groups
    .map(
      (group) =>
        `<span class="legend-item"><i style="background:${group.swatch.fill};border-color:${group.swatch.stroke}"></i>${escapeXml({ text: group.name })}</span>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeXml({ text: title ?? "Graph" })}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: ${resolvedTheme.fontFamily}; background: ${resolvedTheme.palette.background}; color: ${resolvedTheme.palette.foreground}; }
  header { padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
  h1 { margin: 0 0 6px; font-size: 16px; font-weight: 600; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; color: ${resolvedTheme.palette.mutedForeground}; }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .legend-item i { width: 12px; height: 12px; border-radius: 3px; border: 1px solid; display: inline-block; }
  #cy { width: 100vw; height: calc(100vh - 64px); }
</style>
<script src="${escapeXml({ text: cytoscapeUrl })}"></script>
${dagreScripts}
</head>
<body>
<header>${heading}<div class="legend">${legend}</div></header>
<div id="cy"></div>
<script>
  var elements = ${escapeScriptJson({ value: elements })};
  var style = ${escapeScriptJson({ value: buildCytoscapeStyle({ prepared }) })};
  var layout = ${escapeScriptJson({ value: layoutSpec })};
  if (window.cytoscapeDagre) { cytoscape.use(window.cytoscapeDagre); }
  var cy = cytoscape({ container: document.getElementById("cy"), elements: elements, style: style, layout: layout });
</script>
</body>
</html>
`;
}
