import type { Nodes } from "mdast";

/**
 * Walking a Markdown tree. getHeadings, getCodeBlocks, getLists and getLinks
 * were four copies of the same recursive "collect the nodes of type X", and
 * findLinkAtPosition a fifth walk with the position test inlined.
 */

type NodeOfType<K extends Nodes["type"]> = Extract<Nodes, { type: K }>;

/** Every node in document order (the node itself first, then its descendants). */
function* walk(node: Nodes): Generator<Nodes> {
  yield node;
  if ("children" in node) {
    for (const child of node.children) {
      yield* walk(child);
    }
  }
}

/** Every node of `type` under `root`, in document order. */
export function collectNodes<K extends Nodes["type"]>(params: { root: Nodes; type: K }): NodeOfType<K>[] {
  const { root, type } = params;
  return [...walk(root)].filter((node): node is NodeOfType<K> => node.type === type);
}

/** The first node of `type` that spans the given 1-based line and column. */
export function findNodeAt<K extends Nodes["type"]>(params: {
  root: Nodes;
  type: K;
  line: number;
  column: number;
}): NodeOfType<K> | undefined {
  const { root, type, line, column } = params;
  return collectNodes({ root, type }).find((node) => spans({ node, line, column }));
}

/** Whether (line, column) falls between the node's start and end, both inclusive. */
export function spans(params: { node: Nodes; line: number; column: number }): boolean {
  const { node, line, column } = params;
  if (!node.position) return false;
  const { start, end } = node.position;
  const afterStart = line > start.line || (line === start.line && column >= start.column);
  const beforeEnd = line < end.line || (line === end.line && column <= end.column);
  return afterStart && beforeEnd;
}
