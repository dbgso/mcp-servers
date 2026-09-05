/**
 * Public types for mcp-shared-graph-viz.
 *
 * These types deliberately carry no domain vocabulary. Mapping a domain
 * (related documents, dependency chains, import graphs) onto nodes and edges
 * is the caller's responsibility; this library only draws what it is given.
 */

export type NodeShape = "roundRect" | "rect" | "ellipse" | "diamond";

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
  /** Explicit size. Derived from the label when omitted. */
  width?: number;
  height?: number;
  /** Makes the node a link in SVG and HTML output. */
  href?: string;
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
  /** Classification key used to assign line style and color. */
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
  /** Layout area width. Defaults to 1200. */
  width?: number;
  /** Layout area height. Defaults to 800. */
  height?: number;
  /** Node separation multiplier. Defaults to 1. */
  spacing?: number;
  /** Seed for layouts that use randomness, for reproducible output. */
  seed?: number;
}

export interface Palette {
  /** Fill/stroke pairs cycled through in group first-appearance order. */
  swatches: Swatch[];
  background: string;
  foreground: string;
  mutedForeground: string;
  edge: string;
  /** Used for nodes without a group. */
  neutral: Swatch;
}

export interface Swatch {
  fill: string;
  stroke: string;
  text: string;
}

export interface ThemeOptions {
  palette?: Palette;
  fontFamily?: string;
  fontSize?: number;
  /** Draw a background rectangle behind the graph. Defaults to true. */
  drawBackground?: boolean;
}

export type MeasureLabel = (params: { text: string; fontSize: number }) => number;

export interface RenderOptions {
  /** Space around the graph bounds. Defaults to 24. */
  padding?: number;
  theme?: ThemeOptions;
  /** Heading drawn above the graph. */
  title?: string;
  /** Draw a legend of groups. Defaults to true when groups exist. */
  legend?: boolean;
  /** Override label width estimation, e.g. with a real font metric. */
  measureLabel?: MeasureLabel;
}

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutNode {
  id: string;
  label: string;
  /** Label split into rendered lines. */
  lines: string[];
  /** Center of the node. */
  x: number;
  y: number;
  width: number;
  height: number;
  shape: NodeShape;
  group?: string;
  parent?: string;
  href?: string;
  tooltip?: string;
  swatch: Swatch;
  data?: Record<string, unknown>;
}

export interface LaidOutEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: string;
  directed: boolean;
  /** Point on the source node's boundary. */
  sourcePoint: Point;
  /** Point on the target node's boundary. */
  targetPoint: Point;
  /** Control point for curved edges (parallel edges and self loops). */
  controlPoints: Point[];
  data?: Record<string, unknown>;
}

export interface LaidOutGraph {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  bounds: Bounds;
  /** Group name to swatch, in first-appearance order. Drives the legend. */
  groups: { name: string; swatch: Swatch }[];
}

export interface LayoutGraphParams {
  graph: GraphInput;
  layout?: LayoutOptions;
  theme?: ThemeOptions;
  measureLabel?: MeasureLabel;
}

export interface RenderGraphSvgParams extends LayoutGraphParams, RenderOptions {}

export interface RenderGraphHtmlParams {
  graph: GraphInput;
  layout?: LayoutOptions;
  theme?: ThemeOptions;
  title?: string;
  /** cytoscape script URL embedded in the page. */
  cytoscapeUrl?: string;
}
