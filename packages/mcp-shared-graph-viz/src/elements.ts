import { assertValidGraph, resolveEdgeId } from "./errors.js";
import { buildSwatchMap, collectGroups, resolveTheme, swatchFor } from "./theme.js";
import type { GraphInput, NodeShape, Point, Swatch, ThemeOptions } from "./types.js";

/**
 * A cytoscape element, described structurally so callers do not need
 * `@types/cytoscape` just to consume this library.
 */
export interface CytoscapeElement {
  group: "nodes" | "edges";
  data: Record<string, unknown>;
}

export interface PreparedNode {
  id: string;
  label: string;
  shape: NodeShape;
  group?: string;
  parent?: string;
  width?: number;
  height?: number;
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

/** cytoscape's name for each shape this library exposes. */
export const CYTOSCAPE_SHAPES: Record<NodeShape, string> = {
  roundRect: "round-rectangle",
  rect: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
};

/**
 * Resolve everything that does not depend on positions: labels, groups and
 * colors. Node sizing is left to the browser, which can measure text.
 */
export function prepareGraph(params: {
  graph: GraphInput;
  theme?: ThemeOptions;
  groupOrder?: readonly string[];
}): PreparedGraph {
  const { graph, theme, groupOrder } = params;
  assertValidGraph({ graph });

  const resolved = resolveTheme({ theme });
  const groupNames = collectGroups({ graph, groupOrder });
  const swatches = buildSwatchMap({ groups: groupNames, palette: resolved.palette });

  const nodes = graph.nodes.map(
    (node): PreparedNode => ({
      id: node.id,
      label: node.label ?? node.id,
      shape: node.shape ?? DEFAULT_NODE_SHAPE,
      group: node.group,
      parent: node.parent,
      width: node.width,
      height: node.height,
      href: node.href,
      tooltip: node.tooltip,
      swatch: swatchFor({ group: node.group, swatches, palette: resolved.palette }),
      position: node.position,
      data: node.data,
    }),
  );

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

  // A group nobody is in gets a colour but no legend entry: the caller's
  // ordering may list the whole corpus, and a legend should describe the
  // picture in front of you.
  const present = new Set(nodes.map((node) => node.group));
  return {
    nodes,
    edges,
    groups: groupNames
      .filter((name) => present.has(name))
      .map((name) => ({
        name,
        swatch: swatchFor({ group: name, swatches, palette: resolved.palette }),
      })),
  };
}

export function preparedToElements(params: { prepared: PreparedGraph }): CytoscapeElement[] {
  const { prepared } = params;

  const nodeElements = prepared.nodes.map((node): CytoscapeElement => {
    const data: Record<string, unknown> = { id: node.id, label: node.label };
    // cytoscape treats a `parent` key as a compound relationship, so it must be
    // absent rather than undefined for ordinary nodes.
    if (node.parent !== undefined) {
      data.parent = node.parent;
    }
    if (node.width !== undefined) {
      data.width = node.width;
    }
    if (node.height !== undefined) {
      data.height = node.height;
    }
    if (node.href !== undefined) {
      data.href = node.href;
    }
    if (node.tooltip !== undefined) {
      data.tooltip = node.tooltip;
    }
    return { group: "nodes", data };
  });

  const edgeElements = prepared.edges.map((edge): CytoscapeElement => {
    const data: Record<string, unknown> = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      directed: edge.directed,
    };
    if (edge.label !== undefined) {
      data.label = edge.label;
    }
    if (edge.kind !== undefined) {
      data.kind = edge.kind;
    }
    return { group: "edges", data };
  });

  return [...nodeElements, ...edgeElements];
}

/** Positions for the `preset` layout, for the nodes that carry one. */
export function presetPositions(params: { prepared: PreparedGraph }): Map<string, Point> {
  const { prepared } = params;
  const positions = new Map<string, Point>();
  for (const node of prepared.nodes) {
    if (node.position !== undefined) {
      positions.set(node.id, node.position);
    }
  }
  return positions;
}

/**
 * Node ids grouped by `group`, in the same first-appearance order the colours
 * use, for the layouts that arrange clusters rather than individual nodes.
 */
export function clustersOf(params: { prepared: PreparedGraph }): string[][] {
  const { prepared } = params;
  return prepared.groups.map((group) =>
    prepared.nodes.filter((node) => node.group === group.name).map((node) => node.id),
  );
}

export function toCytoscapeElements(params: {
  graph: GraphInput;
  theme?: ThemeOptions;
  groupOrder?: readonly string[];
}): CytoscapeElement[] {
  return preparedToElements({ prepared: prepareGraph(params) });
}
