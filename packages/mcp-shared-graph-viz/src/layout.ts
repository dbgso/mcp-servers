import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";

import { assertKnownLayout, GraphVizError } from "./errors.js";
import { prepareGraph, preparedToElements } from "./elements.js";
import type { PreparedEdge, PreparedGraph, PreparedNode } from "./elements.js";
import {
  boundaryPoint,
  boundsOf,
  controlPointFor,
  parallelOffset,
  selfLoopPath,
} from "./svg/geometry.js";
import type { NodeBox } from "./svg/geometry.js";
import type {
  LaidOutEdge,
  LaidOutGraph,
  LaidOutNode,
  LayoutGraphParams,
  LayoutName,
  LayoutOptions,
  Point,
} from "./types.js";

export const MIN_LAYOUT_EXTENT = 200;

let dagreRegistered = false;

/** cytoscape warns when an extension is registered twice, so guard it. */
function registerDagre(): void {
  if (dagreRegistered) {
    return;
  }
  cytoscape.use(dagre);
  dagreRegistered = true;
}

export interface LayoutSpec {
  name: LayoutName;
  boundingBox?: BoundingBox;
  [key: string]: unknown;
}

export interface BoundingBox {
  x1: number;
  y1: number;
  w: number;
  h: number;
}

/**
 * Layouts that place nodes into a given area rather than deriving positions
 * from the graph itself.
 *
 * These read `cy.width()`/`cy.height()`, which are 0 in headless mode, so they
 * need an explicit `boundingBox`; without one, breadthfirst produces
 * coordinates on the order of 1e49.
 */
export const AREA_BASED_LAYOUTS: LayoutName[] = [
  "grid",
  "circle",
  "concentric",
  "breadthfirst",
];

export function needsBoundingBox(params: { name: LayoutName }): boolean {
  const { name } = params;
  return AREA_BASED_LAYOUTS.includes(name);
}

export const DEFAULT_ASPECT_RATIO = 1.5;
export const AREA_SPREAD = 5;

/**
 * An area proportional to the graph's own size.
 *
 * cytoscape scales layout results into `boundingBox`, so a fixed box would
 * stretch a three-node graph across 1200x800 and squash a large one. Deriving
 * it from the nodes keeps node separation roughly constant instead.
 */
export function estimateBoundingBox(params: {
  nodes: { width: number; height: number }[];
  spacing: number;
  width?: number;
  height?: number;
}): BoundingBox {
  const { nodes, spacing, width, height } = params;
  if (width !== undefined && height !== undefined) {
    return { x1: 0, y1: 0, w: width, h: height };
  }

  const totalArea = nodes.reduce((sum, node) => sum + node.width * node.height, 0);
  const spread = Math.max(totalArea * AREA_SPREAD * spacing * spacing, 1);
  const derivedWidth = Math.ceil(Math.sqrt(spread * DEFAULT_ASPECT_RATIO));
  const derivedHeight = Math.ceil(spread / Math.max(derivedWidth, 1));

  return {
    x1: 0,
    y1: 0,
    w: width ?? Math.max(derivedWidth, MIN_LAYOUT_EXTENT),
    h: height ?? Math.max(derivedHeight, MIN_LAYOUT_EXTENT),
  };
}

/**
 * Layout options for cytoscape.
 *
 * `boundingBox` is supplied only for area-based layouts. cytoscape rescales
 * layout results into that box, so passing it to dagre or cose would override
 * the spacing those layouts computed.
 */
export function buildLayoutSpec(params: {
  layout?: LayoutOptions;
  nodes?: { width: number; height: number }[];
}): LayoutSpec {
  const { layout, nodes = [] } = params;
  const name = layout?.name ?? "dagre";
  assertKnownLayout({ name });

  const spacing = layout?.spacing ?? 1;

  const base: LayoutSpec = {
    name,
    animate: false,
    fit: false,
    padding: 0,
    nodeDimensionsIncludeLabels: false,
  };

  if (needsBoundingBox({ name })) {
    base.boundingBox = estimateBoundingBox({
      nodes,
      spacing,
      width: layout?.width,
      height: layout?.height,
    });
    base.spacingFactor = spacing;
  }

  if (name === "dagre") {
    return {
      ...base,
      rankDir: layout?.direction ?? "TB",
      nodeSep: 40 * spacing,
      rankSep: 70 * spacing,
      edgeSep: 12 * spacing,
    };
  }
  if (name === "breadthfirst") {
    return { ...base, directed: true, grid: true };
  }
  if (name === "cose") {
    return {
      ...base,
      randomize: layout?.seed === undefined,
      nodeRepulsion: 12000 * spacing,
      idealEdgeLength: 90 * spacing,
      numIter: 1000,
    };
  }
  if (name === "concentric") {
    return { ...base, minNodeSpacing: 30 * spacing };
  }
  return base;
}

/**
 * Positions for the `preset` layout.
 *
 * cytoscape ignores the `position` field of an element definition in headless
 * mode, so preset coordinates have to be handed to the layout explicitly.
 * Opting into `preset` without coordinates would silently stack every node at
 * the origin, so that is rejected instead.
 */
export function buildPresetPositions(params: { prepared: PreparedGraph }): Map<string, Point> {
  const { prepared } = params;
  const missing = prepared.nodes.filter((node) => node.position === undefined).map((node) => node.id);
  if (missing.length > 0) {
    throw new GraphVizError(
      `The "preset" layout requires a position on every node. Missing: ${missing.join(", ")}`,
    );
  }
  return new Map(
    prepared.nodes.map((node) => [node.id, node.position as Point] as const),
  );
}

/** Run the layout and read back positions. Always destroys the instance. */
export async function computePositions(params: {
  prepared: PreparedGraph;
  layout?: LayoutOptions;
}): Promise<Map<string, Point>> {
  const { prepared, layout } = params;
  const spec = buildLayoutSpec({ layout, nodes: prepared.nodes });

  if (spec.name === "dagre") {
    registerDagre();
  }
  if (spec.name === "preset") {
    const presets = buildPresetPositions({ prepared });
    spec.positions = (node: { id: () => string }): Point =>
      presets.get(node.id()) ?? { x: 0, y: 0 };
  }

  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: preparedToElements({ prepared }) as cytoscape.ElementDefinition[],
    style: [
      {
        selector: "node",
        style: {
          width: "data(width)",
          height: "data(height)",
          shape: "round-rectangle",
        },
      },
    ],
  });

  try {
    // An empty graph has nothing to lay out and some layouts throw on it.
    if (prepared.nodes.length > 0) {
      const layoutInstance = cy.layout(spec as unknown as cytoscape.LayoutOptions);
      await new Promise<void>((resolve) => {
        layoutInstance.one("layoutstop", () => resolve());
        layoutInstance.run();
      });
    }

    const positions = new Map<string, Point>();
    cy.nodes().forEach((node) => {
      const position = node.position();
      positions.set(node.id(), { x: position.x, y: position.y });
    });
    return positions;
  } finally {
    // Without this the cytoscape instance keeps handles alive and the Node
    // process never exits.
    cy.destroy();
  }
}

export function toNodeBox(params: { node: LaidOutNode }): NodeBox {
  const { node } = params;
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    shape: node.shape,
  };
}

/** Key identifying an unordered node pair, so A→B and B→A share a bundle. */
export function pairKey(params: { source: string; target: string }): string {
  const { source, target } = params;
  return [source, target].sort().join("\u0000");
}

export function groupParallelEdges(params: { edges: PreparedEdge[] }): Map<string, PreparedEdge[]> {
  const { edges } = params;
  const bundles = new Map<string, PreparedEdge[]>();
  for (const edge of edges) {
    const key = pairKey({ source: edge.source, target: edge.target });
    const bundle = bundles.get(key);
    if (bundle === undefined) {
      bundles.set(key, [edge]);
      continue;
    }
    bundle.push(edge);
  }
  return bundles;
}

export function routeEdges(params: {
  edges: PreparedEdge[];
  nodesById: Map<string, LaidOutNode>;
}): LaidOutEdge[] {
  const { edges, nodesById } = params;
  const bundles = groupParallelEdges({ edges });
  const indexInBundle = new Map<string, number>();

  return edges.map((edge): LaidOutEdge => {
    const key = pairKey({ source: edge.source, target: edge.target });
    const bundle = bundles.get(key) ?? [edge];
    const index = indexInBundle.get(key) ?? 0;
    indexInBundle.set(key, index + 1);

    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    /* c8 ignore next 3 -- unreachable: assertValidGraph rejects dangling edges */
    if (sourceNode === undefined || targetNode === undefined) {
      throw new Error(`Edge "${edge.id}" references a node that was not laid out`);
    }

    if (edge.source === edge.target) {
      const loop = selfLoopPath({ box: toNodeBox({ node: sourceNode }) });
      return {
        ...toLaidOutEdgeBase({ edge }),
        sourcePoint: loop.start,
        targetPoint: loop.end,
        controlPoints: [...loop.controlPoints],
      };
    }

    // The offset is applied along the edge's own direction, so a reversed
    // edge would land on the same side as its counterpart without this flip.
    const orientation = edge.source > edge.target ? -1 : 1;
    const offset = parallelOffset({ index, total: bundle.length }) * orientation;
    const control = controlPointFor({
      from: { x: sourceNode.x, y: sourceNode.y },
      to: { x: targetNode.x, y: targetNode.y },
      offset,
    });

    return {
      ...toLaidOutEdgeBase({ edge }),
      sourcePoint: boundaryPoint({ box: toNodeBox({ node: sourceNode }), toward: control }),
      targetPoint: boundaryPoint({ box: toNodeBox({ node: targetNode }), toward: control }),
      controlPoints: offset === 0 ? [] : [control],
    };
  });
}

function toLaidOutEdgeBase(params: {
  edge: PreparedEdge;
}): Omit<LaidOutEdge, "sourcePoint" | "targetPoint" | "controlPoints"> {
  const { edge } = params;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    kind: edge.kind,
    directed: edge.directed,
    data: edge.data,
  };
}

function toLaidOutNode(params: { node: PreparedNode; position: Point }): LaidOutNode {
  const { node, position } = params;
  return {
    id: node.id,
    label: node.label,
    lines: node.lines,
    x: position.x,
    y: position.y,
    width: node.width,
    height: node.height,
    shape: node.shape,
    group: node.group,
    parent: node.parent,
    href: node.href,
    tooltip: node.tooltip,
    swatch: node.swatch,
    data: node.data,
  };
}

/** Assign positions to a caller's graph without rendering it. */
export async function layoutGraph(params: LayoutGraphParams): Promise<LaidOutGraph> {
  const { graph, layout, theme, measureLabel } = params;
  const prepared = prepareGraph({ graph, theme, measureLabel });
  const positions = await computePositions({ prepared, layout });

  const nodes = prepared.nodes.map((node) =>
    toLaidOutNode({ node, position: positions.get(node.id) ?? { x: 0, y: 0 } }),
  );
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges = routeEdges({ edges: prepared.edges, nodesById });

  const bounds = boundsOf({
    boxes: nodes.map((node) => toNodeBox({ node })),
    extraPoints: edges.flatMap((edge) => edge.controlPoints),
    padding: 0,
  });

  return { nodes, edges, bounds, groups: prepared.groups };
}
