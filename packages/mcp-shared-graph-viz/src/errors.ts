import type { GraphInput } from "./types.js";

/**
 * Thrown when the caller's node/edge mapping is inconsistent.
 *
 * A malformed graph is a bug on the calling side, so it fails loudly rather
 * than silently producing a skewed diagram.
 */
export class GraphVizError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphVizError";
  }
}

export function findDuplicateNodeIds(params: { graph: GraphInput }): string[] {
  const { graph } = params;
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      duplicates.add(node.id);
      continue;
    }
    seen.add(node.id);
  }
  return [...duplicates];
}

export interface DanglingEndpoint {
  edgeId: string;
  end: "source" | "target";
  missingId: string;
}

export function findDanglingEndpoints(params: { graph: GraphInput }): DanglingEndpoint[] {
  const { graph } = params;
  const known = new Set(graph.nodes.map((node) => node.id));
  const dangling: DanglingEndpoint[] = [];
  for (const [index, edge] of graph.edges.entries()) {
    const edgeId = resolveEdgeId({ edge, index });
    if (!known.has(edge.source)) {
      dangling.push({ edgeId, end: "source", missingId: edge.source });
    }
    if (!known.has(edge.target)) {
      dangling.push({ edgeId, end: "target", missingId: edge.target });
    }
  }
  return dangling;
}

export function resolveEdgeId(params: {
  edge: { id?: string; source: string; target: string };
  index: number;
}): string {
  const { edge, index } = params;
  return edge.id ?? `${edge.source}->${edge.target}#${index}`;
}

export function findMissingParents(params: { graph: GraphInput }): string[] {
  const { graph } = params;
  const known = new Set(graph.nodes.map((node) => node.id));
  const missing = new Set<string>();
  for (const node of graph.nodes) {
    // A compound parent must itself exist as a node.
    if (node.parent !== undefined && !known.has(node.parent)) {
      missing.add(node.parent);
    }
  }
  return [...missing];
}

export function assertValidGraph(params: { graph: GraphInput }): void {
  const { graph } = params;

  const duplicates = findDuplicateNodeIds({ graph });
  if (duplicates.length > 0) {
    throw new GraphVizError(`Duplicate node ids: ${duplicates.join(", ")}`);
  }

  const dangling = findDanglingEndpoints({ graph });
  if (dangling.length > 0) {
    const details = dangling
      .map((entry) => `${entry.edgeId} (${entry.end}: "${entry.missingId}")`)
      .join(", ");
    throw new GraphVizError(`Edges reference unknown nodes: ${details}`);
  }

  const missingParents = findMissingParents({ graph });
  if (missingParents.length > 0) {
    throw new GraphVizError(`Nodes reference unknown parents: ${missingParents.join(", ")}`);
  }
}

/**
 * Every node needs a position for the layouts that place nodes where the
 * caller says.
 *
 * Without one cytoscape puts the node at the origin, so an incomplete set of
 * coordinates would silently pile nodes on top of each other.
 */
export function assertPositions(params: {
  layoutName: string;
  nodes: { id: string; position?: unknown }[];
}): void {
  const { layoutName, nodes } = params;
  const missing = nodes.filter((node) => node.position === undefined).map((node) => node.id);
  if (missing.length > 0) {
    throw new GraphVizError(
      `The "${layoutName}" layout requires a position on every node. Missing: ${missing.join(", ")}`,
    );
  }
}
