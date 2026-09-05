/**
 * Public types for mcp-shared-graph-viz.
 *
 * These types deliberately carry no domain vocabulary. Mapping a domain
 * (related documents, dependency chains, import graphs) onto nodes and edges
 * is the caller's responsibility; this library only draws what it is given.
 */

export type NodeShape = "roundRect" | "rect" | "ellipse" | "diamond";

export interface Point {
  x: number;
  y: number;
}

export interface GraphNode {
  /** Unique within the graph. */
  id: string;
  /** Displayed text. Falls back to `id`. */
  label?: string;
  /** Grouping key used to assign a color from the palette. */
  group?: string;
  /** Id of a compound (container) node this node belongs to. */
  parent?: string;
  shape?: NodeShape;
  /** Fixed size. Sized from the label by the browser when omitted. */
  width?: number;
  height?: number;
  /** Clicking the node opens this URL. */
  href?: string;
  /** Shown while the pointer is over the node. */
  tooltip?: string;
  /** Caller-owned payload. This library never interprets it. */
  data?: Record<string, unknown>;
  /** Position for the `preset` layout. Ignored by every other layout. */
  position?: Point;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Derived from source and target when omitted. */
  id?: string;
  label?: string;
  /** Classification key, carried through to the element data. */
  kind?: string;
  /** Defaults to true. */
  directed?: boolean;
  data?: Record<string, unknown>;
}

export interface GraphInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type LayoutName =
  | "dagre"
  | "cose"
  | "concentric"
  | "grid"
  | "circle"
  | "breadthfirst"
  | "preset";

export type LayoutDirection = "TB" | "BT" | "LR" | "RL";

export interface LayoutOptions {
  /** Defaults to "dagre". */
  name?: LayoutName;
  /** Rank direction for hierarchical layouts. Defaults to "TB". */
  direction?: LayoutDirection;
  /** Node separation multiplier. Defaults to 1. */
  spacing?: number;
}

export interface Swatch {
  fill: string;
  stroke: string;
  text: string;
}

export interface Palette {
  /** Cycled through in group first-appearance order. */
  swatches: Swatch[];
  background: string;
  foreground: string;
  mutedForeground: string;
  edge: string;
  /** Used for nodes without a group. */
  neutral: Swatch;
}

export interface ThemeOptions {
  palette?: Palette;
  fontFamily?: string;
  fontSize?: number;
}

export interface RenderGraphHtmlParams {
  graph: GraphInput;
  layout?: LayoutOptions;
  theme?: ThemeOptions;
  /** Heading shown above the graph. */
  title?: string;
  /** Draw a legend of groups. Defaults to true when groups exist. */
  legend?: boolean;
  /** cytoscape script URL embedded in the page. */
  cytoscapeUrl?: string;
  /**
   * Overrides the scripts the chosen layout needs, for an offline or
   * self-hosted copy. Only dagre needs any.
   */
  layoutScriptUrls?: string[];
}
