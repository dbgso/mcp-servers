import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import {
  renderGraphHtml,
  type GraphEdge,
  type GraphNode,
  type LayoutDirection,
  type LayoutName,
  type LayoutOptions,
} from "mcp-shared-graph-viz";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { DRAFT_DIR } from "../../../constants.js";
import type { MarkdownSummary } from "../../../types/index.js";

/**
 * Draw the `relatedDocs` graph.
 *
 * This is the dividend of links being frontmatter rather than prose: because
 * every relation is already structured data, turning the corpus into something
 * a person can look at is a mapping, not a parser. All the domain knowledge
 * lives here -- `mcp-shared-graph-viz` is given nodes and edges and knows
 * nothing about documents.
 *
 * Dangling references are drawn rather than dropped. A link to a document that
 * does not exist is exactly what someone opening this graph wants to find, and
 * silently omitting it would make a broken corpus look intact.
 */

const GRAPH_BASE = "mcp-instruction-graphs";

/** Documents with no relation either way, kept out unless asked for. */
const ORPHAN_GROUP = "(unlinked)";
const MISSING_GROUP = "(missing)";

const schema = z.object({
  action: z.literal("graph"),
  id: z
    .string()
    .optional()
    .describe("Draw only the neighbourhood of this document. Omit for the whole corpus."),
  depth: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("How many hops from `id` to include. Defaults to 1. Ignored without `id`."),
  includeUnlinked: z
    .boolean()
    .optional()
    .describe("Include documents that have no relations at all. Defaults to false."),
  layout: z
    .enum(["dagre", "cose", "concentric", "grid", "circle", "breadthfirst"])
    .optional()
    .describe("Layout algorithm. Defaults to dagre."),
  direction: z
    .enum(["TB", "BT", "LR", "RL"])
    .optional()
    .describe(
      "Rank direction for dagre. Defaults to TB. LR reads better for a wide, shallow graph.",
    ),
  spacing: z
    .number()
    .positive()
    .optional()
    .describe("Multiplier on the gaps between nodes. Defaults to 1."),
  outputPath: z
    .string()
    .optional()
    .describe("Where to write the page. Defaults to a file under the system temp directory."),
});

type Args = z.infer<typeof schema>;

export class GraphHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "graph";
  readonly help = `Render the relatedDocs graph as an interactive page.

Usage:
- \`instruction(action: "graph")\` - the whole corpus
- \`instruction(action: "graph", id: "<id>", depth: 2)\` - one document's neighbourhood
- \`instruction(action: "graph", includeUnlinked: true)\` - also show documents with no relations
- \`instruction(action: "graph", direction: "LR")\` - lay the hierarchy out left-to-right

Writes an HTML file and returns its path. Open it in a browser.`;

  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, depth = 1, includeUnlinked = false, layout, direction, spacing, outputPath } =
      params.args;
    const { reader } = params.context;

    const listed = await reader.listDocuments({ recursive: true });
    const documents = listed.documents.filter((doc) => !doc.id.startsWith(DRAFT_DIR));

    if (id !== undefined && !documents.some((doc) => doc.id === id)) {
      return errorResponse(`Error: Document "${id}" not found.` +
        formatNextActions([{
          action: "list",
          description: "See what exists",
          example: `instruction(action: "list", recursive: true)`,
        }]));
    }

    const { nodes, edges } = buildGraph({ documents, focusId: id, depth, includeUnlinked });

    if (nodes.length === 0) {
      return textResponse(
        `No relations to draw${id === undefined ? "" : ` around "${id}"`}.` +
        formatNextActions([{
          action: "link_add",
          description: "Relate two documents",
          example: `instruction(action: "link_add", id: "<id>", relatedDocs: ["<other-id>"])`,
        }]));
    }

    const html = renderGraphHtml({
      graph: { nodes, edges },
      layout: toLayoutOptions({ layout, direction, spacing }),
      title: id === undefined ? "Document relations" : `Relations around ${id}`,
    });

    const target = outputPath ?? defaultOutputPath(id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, html, "utf-8");

    const missing = nodes.filter((node) => node.group === MISSING_GROUP);

    return textResponse(
      `Wrote the relation graph to:

${target}

${nodes.length} documents, ${edges.length} relations. Open the file in a browser.` +
      (missing.length === 0
        ? ""
        : `

**${missing.length} link${missing.length === 1 ? "" : "s"} point at documents that do not exist**, drawn as \`${MISSING_GROUP}\`: ${missing.map((node) => node.id).join(", ")}`) +
      formatNextActions([
        {
          action: "lint",
          description: "Check the corpus for other problems",
          example: `instruction(action: "lint")`,
        },
        {
          action: "graph",
          description: "Focus on one document",
          example: `instruction(action: "graph", id: "${nodes[0].id}", depth: 2)`,
        },
      ]),
    );
  }
}

/**
 * The category a document belongs to, used to colour it. `git__workflow` is in
 * `git`; a top-level document is in its own group so it does not share a colour
 * with every other top-level document.
 */
function groupOf(docId: string): string {
  const separatorIndex = docId.indexOf("__");
  return separatorIndex === -1 ? docId : docId.slice(0, separatorIndex);
}

export function buildGraph(params: {
  documents: MarkdownSummary[];
  focusId?: string;
  depth: number;
  includeUnlinked: boolean;
}): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { documents, focusId, depth, includeUnlinked } = params;

  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const known = new Set(byId.keys());

  // Every relation in the corpus, before any filtering. Undirected adjacency is
  // kept alongside so a neighbourhood can be walked in both directions -- being
  // referenced by a document is as much a relation as referencing one.
  const allEdges: GraphEdge[] = [];
  const adjacency = new Map<string, Set<string>>();
  const relate = (params: { from: string; to: string }): void => {
    const { from, to } = params;
    for (const [a, b] of [[from, to], [to, from]] as const) {
      const neighbours = adjacency.get(a) ?? new Set<string>();
      neighbours.add(b);
      adjacency.set(a, neighbours);
    }
  };

  for (const doc of documents) {
    for (const target of doc.relatedDocs ?? []) {
      allEdges.push({ source: doc.id, target });
      relate({ from: doc.id, to: target });
    }
  }

  const included = focusId === undefined
    ? allIncluded({ documents, adjacency, includeUnlinked })
    : neighbourhood({ focusId, adjacency, depth });

  const edges = allEdges.filter((edge) => included.has(edge.source) && included.has(edge.target));

  const nodes: GraphNode[] = [...included].map((nodeId) => {
    const doc = byId.get(nodeId);
    if (doc === undefined) {
      return {
        id: nodeId,
        label: nodeId,
        group: MISSING_GROUP,
        shape: "diamond" as const,
        tooltip: `${nodeId} — referenced but does not exist`,
      };
    }
    const linked = (adjacency.get(nodeId)?.size ?? 0) > 0;
    return {
      id: nodeId,
      label: nodeId,
      group: linked ? groupOf(nodeId) : ORPHAN_GROUP,
      tooltip: doc.description === "" ? nodeId : `${nodeId} — ${doc.description}`,
    };
  });

  // Sorted so the same corpus produces the same page, which makes two renders
  // comparable and keeps the layout from reshuffling between runs.
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => `${a.source}\u0000${a.target}`.localeCompare(`${b.source}\u0000${b.target}`));

  return { nodes, edges };

  function allIncluded(args: {
    documents: MarkdownSummary[];
    adjacency: Map<string, Set<string>>;
    includeUnlinked: boolean;
  }): Set<string> {
    const result = new Set<string>();
    for (const doc of args.documents) {
      if (args.includeUnlinked || (args.adjacency.get(doc.id)?.size ?? 0) > 0) {
        result.add(doc.id);
      }
    }
    // Dangling targets: referenced, not in the corpus.
    for (const edge of allEdges) {
      if (!known.has(edge.target)) result.add(edge.target);
    }
    return result;
  }
}

function neighbourhood(params: {
  focusId: string;
  adjacency: Map<string, Set<string>>;
  depth: number;
}): Set<string> {
  const { focusId, adjacency, depth } = params;
  const reached = new Set<string>([focusId]);
  let frontier = [focusId];

  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const neighbour of adjacency.get(nodeId) ?? []) {
        if (reached.has(neighbour)) continue;
        reached.add(neighbour);
        next.push(neighbour);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  return reached;
}

/**
 * Undefined unless something was actually asked for, so the renderer keeps its
 * own defaults rather than being handed a layout object full of undefined.
 */
function toLayoutOptions(params: {
  layout?: LayoutName;
  direction?: LayoutDirection;
  spacing?: number;
}): LayoutOptions | undefined {
  const { layout, direction, spacing } = params;

  // Nothing to say -- let the renderer decide.
  if (layout === undefined && direction === undefined && spacing === undefined) return undefined;

  return { name: layout, direction, spacing };
}

function defaultOutputPath(focusId?: string): string {
  const name = focusId === undefined ? "corpus" : encodeURIComponent(focusId);
  return path.join(os.tmpdir(), GRAPH_BASE, `${name}-${Date.now()}.html`);
}
