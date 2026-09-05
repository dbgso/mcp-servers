import { CYTOSCAPE_SHAPES, prepareGraph, preparedToElements, presetPositions } from "./elements.js";
import type { PreparedGraph } from "./elements.js";
import { assertPresetPositions } from "./errors.js";
import { escapeScriptJson, escapeXml } from "./escape.js";
import { buildLayoutSpec } from "./layout-spec.js";
import { resolveTheme } from "./theme.js";
import type { ResolvedTheme } from "./theme.js";
import type { RenderGraphHtmlParams } from "./types.js";

export const DEFAULT_CYTOSCAPE_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.34.2/cytoscape.min.js";

/** dagre lives in a plugin, and the plugin needs dagre itself. */
export const DEFAULT_DAGRE_URLS = [
  "https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js",
  "https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.min.js",
];

export const MAX_LABEL_WIDTH_PX = 170;

/**
 * The cytoscape style sheet.
 *
 * Sizing is left to cytoscape (`width: label` plus padding) rather than being
 * computed here: the browser can measure text, and this library cannot.
 */
export function buildCytoscapeStyle(params: {
  prepared: PreparedGraph;
  theme: ResolvedTheme;
}): unknown[] {
  const { prepared, theme } = params;

  const perNode = prepared.nodes.flatMap((node) => {
    const style: Record<string, unknown> = {
      "background-color": node.swatch.fill,
      "border-color": node.swatch.stroke,
      color: node.swatch.text,
      shape: CYTOSCAPE_SHAPES[node.shape],
    };
    return [{ selector: `node[id = ${JSON.stringify(node.id)}]`, style }];
  });

  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        width: "label",
        height: "label",
        padding: "12px",
        shape: "round-rectangle",
        "border-width": 1.5,
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        "text-max-width": `${MAX_LABEL_WIDTH_PX}px`,
        "font-size": theme.fontSize,
        "font-family": theme.fontFamily,
      },
    },
    // Fixed sizes, for the callers that ask for them.
    { selector: "node[width]", style: { width: "data(width)" } },
    { selector: "node[height]", style: { height: "data(height)" } },
    {
      selector: ":parent",
      style: {
        "background-opacity": 0.06,
        "border-style": "dashed",
        "text-valign": "top",
        padding: "18px",
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.4,
        "curve-style": "bezier",
        "line-color": theme.palette.edge,
        "target-arrow-color": theme.palette.edge,
        "arrow-scale": 0.9,
        label: "data(label)",
        "font-size": theme.fontSize - 2,
        color: theme.palette.mutedForeground,
        "text-background-color": theme.palette.background,
        "text-background-opacity": 0.85,
        "text-background-padding": "2px",
      },
    },
    { selector: "edge[?directed]", style: { "target-arrow-shape": "triangle" } },
    // Dim everything except the hovered node and its immediate neighbourhood.
    { selector: ".faded", style: { opacity: 0.15 } },
    ...perNode,
  ];
}

function legendMarkup(params: { prepared: PreparedGraph; show: boolean }): string {
  const { prepared, show } = params;
  if (!show || prepared.groups.length === 0) {
    return "";
  }
  const items = prepared.groups
    .map(
      (group) =>
        `<span class="legend-item"><i style="background:${group.swatch.fill};border-color:${group.swatch.stroke}"></i>${escapeXml({ text: group.name })}</span>`,
    )
    .join("");
  return `<div class="legend">${items}</div>`;
}

/**
 * An interactive page: pan, zoom, hover to isolate a node's neighbourhood, and
 * click through on nodes that carry an href.
 *
 * Synchronous because the layout runs in the browser's cytoscape; this
 * function only assembles the document.
 */
export function renderHtml(params: RenderGraphHtmlParams): string {
  const {
    graph,
    layout,
    theme,
    title,
    legend = true,
    cytoscapeUrl = DEFAULT_CYTOSCAPE_URL,
    dagreUrls = DEFAULT_DAGRE_URLS,
  } = params;

  const prepared = prepareGraph({ graph, theme });
  const resolvedTheme = resolveTheme({ theme });

  if ((layout?.name ?? "dagre") === "preset") {
    assertPresetPositions({ nodes: prepared.nodes });
  }

  const layoutSpec = buildLayoutSpec({
    layout,
    presetPositions: presetPositions({ prepared }),
  });

  const dagreScripts =
    layoutSpec.name === "dagre"
      ? dagreUrls.map((url) => `<script src="${escapeXml({ text: url })}"></script>`).join("\n")
      : "";

  const heading = title === undefined ? "" : `<h1>${escapeXml({ text: title })}</h1>`;
  const documentTitle = escapeXml({ text: title ?? "Graph" });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${documentTitle}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ${resolvedTheme.fontFamily};
    background: ${resolvedTheme.palette.background};
    color: ${resolvedTheme.palette.foreground};
  }
  header {
    padding: 10px 16px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px 20px;
  }
  h1 { margin: 0; font-size: 15px; font-weight: 600; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: ${resolvedTheme.palette.mutedForeground}; }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .legend-item i { width: 11px; height: 11px; border-radius: 3px; border: 1px solid; display: inline-block; }
  #cy { width: 100%; height: 100%; }
  #stage { position: absolute; inset: 0; top: var(--header-height, 52px); }
  #tip {
    position: absolute;
    left: 12px;
    bottom: 12px;
    max-width: min(520px, calc(100% - 24px));
    padding: 7px 11px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: ${resolvedTheme.palette.background};
    font-size: 12px;
    color: ${resolvedTheme.palette.mutedForeground};
    box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
    pointer-events: none;
  }
  #tip[hidden] { display: none; }
</style>
<script src="${escapeXml({ text: cytoscapeUrl })}"></script>
${dagreScripts}
</head>
<body>
<header id="head">${heading}${legendMarkup({ prepared, show: legend })}</header>
<div id="stage"><div id="cy"></div></div>
<div id="tip" hidden></div>
<script>
(function () {
  var elements = ${escapeScriptJson({ value: preparedToElements({ prepared }) })};
  var style = ${escapeScriptJson({ value: buildCytoscapeStyle({ prepared, theme: resolvedTheme }) })};
  var layout = ${escapeScriptJson({ value: layoutSpec })};

  var head = document.getElementById("head");
  document.documentElement.style.setProperty("--header-height", head.offsetHeight + "px");

  if (window.cytoscapeDagre) { cytoscape.use(window.cytoscapeDagre); }

  var cy = cytoscape({
    container: document.getElementById("cy"),
    elements: elements,
    style: style,
    layout: layout,
    wheelSensitivity: 0.2,
  });

  var tip = document.getElementById("tip");

  cy.on("mouseover", "node", function (event) {
    var node = event.target;
    var keep = node.closedNeighborhood();
    cy.elements().difference(keep).addClass("faded");
    var text = node.data("tooltip") || node.data("label");
    tip.textContent = text;
    tip.hidden = false;
  });

  cy.on("mouseout", "node", function () {
    cy.elements().removeClass("faded");
    tip.hidden = true;
  });

  cy.on("tap", "node", function (event) {
    var href = event.target.data("href");
    if (href) { window.open(href, "_blank", "noopener"); }
  });

  // Extension point: the page is a starting point, not a dead end.
  window.graphViz = { cy: cy };
})();
</script>
</body>
</html>
`;
}
