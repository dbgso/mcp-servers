import { escapeScriptJson, escapeXml } from "./escape.js";
import type { ResolvedTheme } from "../../theme.js";

export interface DocumentParams {
  title?: string;
  theme: ResolvedTheme;
  /** Legend entries, already resolved to colors. Empty means no legend. */
  legend: { name: string; fill: string; stroke: string }[];
  scriptUrls: string[];
  elements: unknown;
  style: unknown;
  layout: unknown;
}

function legendMarkup(params: { legend: DocumentParams["legend"] }): string {
  const { legend } = params;
  if (legend.length === 0) {
    return "";
  }
  const items = legend
    .map(
      (entry) =>
        `<span class="legend-item"><i style="background:${entry.fill};border-color:${entry.stroke}"></i>${escapeXml({ text: entry.name })}</span>`,
    )
    .join("");
  return `<div class="legend">${items}</div>`;
}

function headingMarkup(params: { title?: string }): string {
  const { title } = params;
  if (title === undefined) {
    return "";
  }
  return `<h1>${escapeXml({ text: title })}</h1>`;
}

/** The page: styles, the embedded graph, and the interactions. */
export function buildDocument(params: DocumentParams): string {
  const { title, theme, legend, scriptUrls, elements, style, layout } = params;
  const scripts = scriptUrls
    .map((url) => `<script src="${escapeXml({ text: url })}"></script>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeXml({ text: title ?? "Graph" })}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ${theme.fontFamily};
    background: ${theme.palette.background};
    color: ${theme.palette.foreground};
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
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: ${theme.palette.mutedForeground}; }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .legend-item i { width: 11px; height: 11px; border-radius: 3px; border: 1px solid; display: inline-block; }
  #stage { position: absolute; inset: 0; top: var(--header-height, 52px); }
  #cy { width: 100%; height: 100%; }
  #tip {
    position: absolute;
    left: 12px;
    bottom: 12px;
    max-width: min(520px, calc(100% - 24px));
    padding: 7px 11px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    background: ${theme.palette.background};
    font-size: 12px;
    color: ${theme.palette.mutedForeground};
    box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
    pointer-events: none;
  }
  #tip[hidden] { display: none; }
</style>
${scripts}
</head>
<body>
<header id="head">${headingMarkup({ title })}${legendMarkup({ legend })}</header>
<div id="stage"><div id="cy"></div></div>
<div id="tip" hidden></div>
<script>
(function () {
  var elements = ${escapeScriptJson({ value: elements })};
  var style = ${escapeScriptJson({ value: style })};
  var layout = ${escapeScriptJson({ value: layout })};

  var head = document.getElementById("head");
  document.documentElement.style.setProperty("--header-height", head.offsetHeight + "px");

  // Constructed without a layout on purpose. Nodes here are sized by their
  // label (\`width: label\`), and that is not resolved until cytoscape has
  // rendered once and measured the text -- so a layout run from the
  // constructor sees every node as a point. cytoscape caches \`takesUpSpace()\`
  // per style revision, and with a zero width it caches false, which makes
  // \`layoutDimensions()\` return 1x1 for the rest of the page's life. The
  // cose-family layouts then place 350px-wide nodes 60px apart: they cover
  // each other, the edges vanish underneath, and nothing reports an error.
  //
  // Measured on a 93-node, 126-edge graph with long ids: 456 of 4278 node
  // pairs overlapped, the worst by 87% of a node's area. Re-running the layout
  // after the first render does not fix it (449 pairs) -- the cached value is
  // still false. Giving each node the size its label measured does (79 pairs),
  // because a concrete width is one cytoscape can compute from.
  var cy = cytoscape({
    container: document.getElementById("cy"),
    elements: elements,
    style: style,
  });

  function sizeNodesFromLabels() {
    cy.batch(function () {
      cy.nodes().forEach(function (node) {
        // A caller that supplied its own size keeps it; \`node[width]\` in the
        // stylesheet is what both paths go through.
        if (node.data("width") === undefined) {
          node.data("width", Math.ceil(node.width()));
        }
        if (node.data("height") === undefined) {
          node.data("height", Math.ceil(node.height()));
        }
      });
    });
  }

  var laidOut = false;
  function layOut() {
    if (laidOut) { return; }
    laidOut = true;
    sizeNodesFromLabels();
    cy.layout(layout).run();
  }

  // Whichever comes first: the render that measures the labels, or the next
  // frame if this build renders synchronously and the event has already gone.
  cy.one("render", layOut);
  requestAnimationFrame(layOut);

  var tip = document.getElementById("tip");

  cy.on("mouseover", "node", function (event) {
    var node = event.target;
    cy.elements().difference(node.closedNeighborhood()).addClass("faded");
    tip.textContent = node.data("tooltip") || node.data("label");
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
