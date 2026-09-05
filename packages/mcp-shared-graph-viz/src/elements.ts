import { estimateTextWidth, measureNode } from "./measure.js";
import { buildSwatchMap, collectGroups, resolveTheme, swatchFor } from "./theme.js";
import { assertValidGraph, resolveEdgeId } from "./errors.js";
import type {
  GraphInput,
  MeasureLabel,
  NodeShape,
  Point,
  Swatch,
  ThemeOptions,
} from "./types.js";

/**
 * A cytoscape element, described structurally so callers do not need
 * `@types/cytoscape` just to consume this library.
 */
export interface CytoscapeElement {
  group: "nodes" | "edges";
  data: Record<string, unknown>;
  position?: Point;
}

export interface PreparedNode {
  id: string;
  label: string;
  lines: string[];
  width: number;
  height: number;
  shape: NodeShape;
  group?: string;
  parent?: string;
  href?: string;
  tooltip?: string;
  swatch: Swatch;
  position?: Point;
  data?: Record<string, unknown>;
}

export interface PreparedEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  kind?: string;
  directed: boolean;
  data?: Record<string, unknown>;
}

export interface PreparedGraph {
  nodes: PreparedNode[];
  edges: PreparedEdge[];
  groups: { name: string; swatch: Swatch }[];
}

export const DEFAULT_NODE_SHAPE: NodeShape = "roundRect";

/**
 * Resolve everything that does not depend on positions: labels, wrapping,
 * node sizes and colors. Sizes are settled here so the layout engine can
 * account for real dimensions instead of guessing.
 */
export function prepareGraph(params: {
  graph: GraphInput;
  theme?: ThemeOptions;
  measureLabel?: MeasureLabel;
}): PreparedGraph {
  const { graph, theme, measureLabel } = params;
  assertValidGraph({ graph });

  const resolved = resolveTheme({ theme });
  const measure = measureLabel ?? estimateTextWidth;
  const groupNames = collectGroups({ graph });
  const swatches = buildSwatchMap({ groups: groupNames, palette: resolved.palette });

  const nodes = graph.nodes.map((node): PreparedNode => {
    const label = node.label ?? node.id;
    const measured = measureNode({
      label,
      fontSize: resolved.fontSize,
      measure,
      explicitWidth: node.width,
      explicitHeight: node.height,
    });
    return {
      id: node.id,
      label,
      lines: measured.lines,
      width: measured.width,
      height: measured.height,
      shape: node.shape ?? DEFAULT_NODE_SHAPE,
      group: node.group,
      parent: node.parent,
      href: node.href,
      tooltip: node.tooltip,
      swatch: swatchFor({ group: node.group, swatches, palette: resolved.palette }),
      position: node.position,
      data: node.data,
    };
  });

  const edges = graph.edges.map(
    (edge, index): PreparedEdge => ({
      id: resolveEdgeId({ edge, index }),
      source: edge.source,
      target: edge.target,
      label: edge.label,
      kind: edge.kind,
      directed: edge.directed ?? true,
      data: edge.data,
    }),
  );

  return {
    nodes,
    edges,
    groups: groupNames.map((name) => ({
      name,
      swatch: swatchFor({ group: name, swatches, palette: resolved.palette }),
    })),
  };
}

export function preparedToElements(params: { prepared: PreparedGraph }): CytoscapeElement[] {
  const { prepared } = params;

  const nodeElements = prepared.nodes.map((node): CytoscapeElement => {
    const data: Record<string, unknown> = {
      id: node.id,
      label: node.label,
      width: node.width,
      height: node.height,
    };
    // cytoscape treats a `parent` key as a compound relationship, so it must
    // be absent rather than undefined for ordinary nodes.
    if (node.parent !== undefined) {
      data.parent = node.parent;
    }
    if (node.position === undefined) {
      return { group: "nodes", data };
    }
    return { group: "nodes", data, position: { ...node.position } };
  });

  const edgeElements = prepared.edges.map(
    (edge): CytoscapeElement => ({
      group: "edges",
      data: { id: edge.id, source: edge.source, target: edge.target },
    }),
  );

  return [...nodeElements, ...edgeElements];
}

export function toCytoscapeElements(params: {
  graph: GraphInput;
  theme?: ThemeOptions;
  measureLabel?: MeasureLabel;
}): CytoscapeElement[] {
  const prepared = prepareGraph(params);
  return preparedToElements({ prepared });
}
