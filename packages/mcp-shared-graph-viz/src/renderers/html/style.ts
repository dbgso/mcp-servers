import { CYTOSCAPE_SHAPES } from "../../elements.js";
import type { PreparedGraph } from "../../elements.js";
import type { ResolvedTheme } from "../../theme.js";
import type { EdgeStyle, LayoutDirection } from "../../types.js";

export const DEFAULT_EDGE_STYLE: EdgeStyle = "bezier";

/**
 * `taxi` draws right-angled elbows, and needs to know which way the graph
 * runs; the layout's own direction is the answer, so it is not asked for
 * twice.
 */
function taxiDirection(params: { direction?: LayoutDirection }): string {
  const { direction } = params;
  return { TB: "downward", BT: "upward", LR: "rightward", RL: "leftward" }[direction ?? "TB"];
}

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
  edgeStyle?: EdgeStyle;
  direction?: LayoutDirection;
}): unknown[] {
  const { prepared, theme, edgeStyle = DEFAULT_EDGE_STYLE, direction } = params;

  const perNode = prepared.nodes.map((node) => ({
    selector: `node[id = ${JSON.stringify(node.id)}]`,
    style: {
      "background-color": node.swatch.fill,
      "border-color": node.swatch.stroke,
      color: node.swatch.text,
      shape: CYTOSCAPE_SHAPES[node.shape],
    },
  }));

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
        "curve-style": edgeStyle,
        "taxi-direction": taxiDirection({ direction }),
        "taxi-turn": "50%",
        "line-color": theme.palette.edge,
        "target-arrow-color": theme.palette.edge,
        "arrow-scale": 0.9,
      },
    },
    // Scoped to edges that carry one: mapping `label` on every edge makes
    // cytoscape warn once per edge that has no such data.
    {
      selector: "edge[label]",
      style: {
        label: "data(label)",
        "font-size": theme.fontSize - 2,
        "font-family": theme.fontFamily,
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
