import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import {
  renderGraphHtml,
  type GraphEdge,
  type GraphNode,
  type EdgeStyle,
  type LayoutDirection,
  type LayoutName,
  type LayoutOptions,
} from "mcp-shared-graph-viz";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { looseBoolean, looseNumber } from "../schema-coerce.js";
import { DRAFT_PREFIX, isInternalDocument } from "../../../constants.js";
import { isDescriptionMissing } from "../../../services/metadata-completeness.js";
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

/**
 * Every layout the renderer offers except `preset`, which places nodes where
 * the caller says and so is not something to pick from a menu -- this handler
 * has no positions to give it.
 *
 * Written out rather than read from `layoutNames()` so the values stay literal
 * types in the schema. `graph-handler.test.ts` fails if the library gains or
 * loses one, which is the drift this would otherwise invite.
 */
export const LAYOUT_NAMES = [
  "dagre",
  "cose",
  "concentric",
  "grid",
  "circle",
  "breadthfirst",
  "fcose",
  "cola",
  "klay",
  "cise",
  "avsdf",
  "elk-layered",
  "elk-mrtree",
  "elk-stress",
] as const;

const schema = z.object({
  action: z.literal("graph"),
  id: z
    .string()
    .optional()
    .describe("Draw only the neighbourhood of this document. Omit for the whole corpus."),
  depth: looseNumber(
    z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("How many hops from `id` to include. Defaults to 1. Ignored without `id`."),
  ),
  includeUnlinked: looseBoolean(
    z
      .boolean()
      .optional()
      .describe("Include documents that have no relations at all. Defaults to false."),
  ),
  layout: z
    .enum(LAYOUT_NAMES)
    .optional()
    .describe("Layout algorithm. Defaults to dagre."),
  direction: z
    .enum(["TB", "BT", "LR", "RL"])
    .optional()
    .describe(
      "Rank direction for dagre. Defaults to TB. LR reads better for a wide, shallow graph.",
    ),
  spacing: looseNumber(
    z
      .number()
      .positive()
      .optional()
      .describe("Multiplier on the gaps between nodes. Defaults to 1."),
  ),
  edgeStyle: z
    .enum(["bezier", "taxi", "segments", "straight", "haystack"])
    .optional()
    .describe(
      "How edges are drawn. Defaults to bezier. taxi takes its bearing from " +
      "`direction`, so a hierarchy does not need it stated twice.",
    ),
  format: z
    .enum(["html", "text"])
    .optional()
    .describe(
      "html writes a page for a person to look at; text returns the same graph as an " +
      "adjacency list in the response, for a caller that has no browser. Defaults to html.",
    ),
  outputPath: z
    .string()
    .optional()
    .describe(
      "Where to write the page. Defaults to a file under the system temp directory. " +
      "Ignored by format: \"text\", which returns the graph rather than writing it.",
    ),
});

type Args = z.infer<typeof schema>;

/** A graph ready to be drawn or written out. */
type Graph = { nodes: GraphNode[]; edges: GraphEdge[] };

/**
 * Why an id is not in the graph.
 *
 * Out of scope and absent are different facts, and reporting the first as the
 * second sends the caller off to check an id that was right. A draft is not
 * missing; the graph is drawn over the promoted corpus, which it has not
 * joined yet.
 */
function notInTheGraph(params: { id: string; all: MarkdownSummary[] }): ToolResponse {
  const { id, all } = params;

  // Either form: the plain id every action takes, and the prefixed one the
  // report used to print, which is a plausible thing to paste back.
  const bare = id.startsWith(DRAFT_PREFIX) ? id.slice(DRAFT_PREFIX.length) : id;

  if (!all.some((doc) => doc.id === DRAFT_PREFIX + bare)) {
    return errorResponse(
      `Error: Document "${id}" not found.` +
      formatNextActions([{
        action: "list",
        description: "See what exists",
        example: `instruction(action: "list", recursive: true)`,
      }]));
  }

  return errorResponse(
    `"${bare}" is a draft, and the relation graph is drawn over the promoted corpus. Its links are readable now, and it joins the graph when it is promoted.` +
    formatNextActions([
      {
        action: "read_meta",
        description: "Read the draft's links",
        example: `instruction(action: "read_meta", id: "${bare}")`,
      },
      {
        action: "graph",
        description: "Draw the corpus it will join",
        example: `instruction(action: "graph")`,
      },
    ]));
}

/** An id the graph does not hold is a refusal, not an empty drawing. */
function refuseUnknownId(params: {
  id?: string;
  documents: MarkdownSummary[];
  all: MarkdownSummary[];
}): ToolResponse | null {
  const { id, documents, all } = params;

  if (id !== undefined && !documents.some((doc) => doc.id === id)) {
    return notInTheGraph({ id, all });
  }
  return null;
}

/** The wording of the refusal, kept apart so the decision above it stays readable. */
function drawingOptionsRefusal(params: { given: string[]; id?: string }): string {
  const { given, id } = params;
  const focus = id === undefined ? "" : `, id: "${id}"`;

  return (
    `${given.join(", ")} ${given.length === 1 ? "describes" : "describe"} how the graph is drawn, and \`format: "text"\` does not draw it.` +
    formatNextActions([
      {
        action: "graph",
        description: "Draw it, with those options",
        example: `instruction(action: "graph"${focus}, ${given.map((name) => `${name}: <value>`).join(", ")})`,
      },
      {
        action: "graph",
        description: "Keep the text, without them",
        example: `instruction(action: "graph"${focus}, format: "text")`,
      },
    ]));
}

/**
 * The arguments that only reach the renderer, when there is no drawing.
 *
 * `format: "text"` used to accept all five and drop them: a call naming a
 * layout, an edge style and an `outputPath` got the text back inline, wrote no
 * file, and said nothing about either. `outputPath` is honoured instead --
 * writing text to a named file is a thing this can do. The other four have no
 * meaning without a drawing, so they are refused rather than discarded.
 */
function refuseDrawingOptions(params: {
  format: "html" | "text";
  id?: string;
  layout?: LayoutName;
  direction?: LayoutDirection;
  spacing?: number;
  edgeStyle?: EdgeStyle;
}): ToolResponse | null {
  const { format, id, layout, direction, spacing, edgeStyle } = params;
  if (format !== "text") return null;

  const given = [
    ["layout", layout !== undefined],
    ["direction", direction !== undefined],
    ["spacing", spacing !== undefined],
    ["edgeStyle", edgeStyle !== undefined],
  ].filter(([, present]) => present).map(([name]) => name as string);

  if (given.length === 0) return null;

  return errorResponse(drawingOptionsRefusal({ given, id }));
}

/**
 * The text rendering, in the response or in a file.
 *
 * No `defaultOutputPath` fallback, unlike the drawing: text with nowhere named
 * belongs in the response, and writing a file nobody asked for is how a
 * documents directory fills up with artefacts.
 */
async function textGraph(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusId?: string;
  depth: number;
  outputPath?: string;
}): Promise<ToolResponse> {
  const { nodes, edges, focusId, depth, outputPath } = params;
  const graphText = formatGraphAsText({ nodes, edges, focusId, depth });

  if (outputPath === undefined) return textResponse(graphText);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, graphText, "utf-8");

  return textResponse(
    `Wrote the relation graph as text to:\n\n${outputPath}\n\n${nodes.length} documents, ${edges.length} relations.`);
}

/** What to draw: the whole corpus, one hop out, links only, unless asked otherwise. */
function graphScope(args: Args): { focusId?: string; depth: number; includeUnlinked: boolean } {
  const { id, depth = 1, includeUnlinked = false } = args;
  return { focusId: id, depth, includeUnlinked };
}

/** How to present it: a page, unless the caller has no browser to open one in. */
function graphFormat(args: Args): "html" | "text" {
  return args.format ?? "html";
}

/** An empty graph is a different answer from an id the corpus does not hold. */
function nothingToDraw(focusId?: string): ToolResponse {
  return textResponse(
    `No relations to draw${focusId === undefined ? "" : ` around "${focusId}"`}.` +
    formatNextActions([{
      action: "link_add",
      description: "Relate two documents",
      example: `instruction(action: "link_add", id: "<id>", relatedDocs: ["<other-id>"], explanation: "<what the link means>")`,
    }]));
}

function graphTitle(focusId?: string): string {
  return focusId === undefined ? "Document relations" : `Relations around ${focusId}`;
}

/**
 * Dangling links are the reason to open the graph at all, so the message counts
 * them rather than leaving them to be spotted in the picture.
 */
function missingLinksNote(nodes: GraphNode[]): string {
  const missing = nodes.filter((node) => node.group === MISSING_GROUP);
  if (missing.length === 0) return "";

  return `

**${missing.length} link${missing.length === 1 ? "" : "s"} point at documents that do not exist**, drawn as \`${MISSING_GROUP}\`: ${missing.map((node) => node.id).join(", ")}`;
}

function wroteGraphMessage(params: { target: string; nodes: GraphNode[]; edges: GraphEdge[] }): string {
  const { target, nodes, edges } = params;

  return (
    `Wrote the relation graph to:

${target}

${nodes.length} documents, ${edges.length} relations. Open the file in a browser.` +
    missingLinksNote(nodes) +
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
    ]));
}

export class GraphHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "graph";
  readonly help = `Render the relatedDocs graph of the promoted corpus as an interactive page. Drafts are not in it.

Usage:
- \`instruction(action: "graph")\` - the whole corpus
- \`instruction(action: "graph", id: "<id>", depth: 2)\` - one document's neighbourhood
- \`instruction(action: "graph", includeUnlinked: true)\` - also show documents with no relations
- \`instruction(action: "graph", direction: "LR")\` - lay the hierarchy out left-to-right
- \`instruction(action: "graph", format: "text")\` - the same graph as an adjacency list
- \`instruction(action: "graph", id: "<id>", depth: 2, format: "text")\` - what references
  it and what it references, to that depth

Writes an HTML file and returns its path. Open it in a browser.`;

  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { args, context } = params;
    const { id, layout, direction, spacing, edgeStyle } = args;

    const misplaced = refuseDrawingOptions({
      format: graphFormat(args),
      id,
      layout,
      direction,
      spacing,
      edgeStyle,
    });
    if (misplaced !== null) return misplaced;

    return this.render({ args, reader: context.reader });
  }

  /** Everything after the arguments have been found to agree with each other. */
  private async render(params: {
    args: Args;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { args, reader } = params;

    const listed = await reader.listDocuments({ recursive: true });
    const documents = listed.documents.filter((doc) => !isInternalDocument(doc.id));

    const unknown = refuseUnknownId({ id: args.id, documents, all: listed.documents });
    if (unknown !== null) return unknown;

    const scope = graphScope(args);
    const graph = buildGraph({ documents, ...scope });

    if (graph.nodes.length === 0) return nothingToDraw(args.id);

    return this.present({ args, documents, graph, depth: scope.depth });
  }

  private present(params: {
    args: Args;
    documents: MarkdownSummary[];
    graph: Graph;
    depth: number;
  }): Promise<ToolResponse> {
    const { args, documents, graph, depth } = params;

    if (graphFormat(args) === "text") {
      return textGraph({ ...graph, focusId: args.id, depth, outputPath: args.outputPath });
    }

    return this.writePage({ args, documents, graph });
  }

  private async writePage(params: {
    args: Args;
    documents: MarkdownSummary[];
    graph: Graph;
  }): Promise<ToolResponse> {
    const { args, documents, graph } = params;
    const { id, layout, direction, spacing, edgeStyle, outputPath } = args;

    const html = renderGraphHtml({
      graph,
      layout: toLayoutOptions({ layout, direction, spacing }),
      edgeStyle,
      // From the whole corpus, not this view: a group has to keep its colour
      // between the corpus graph and a close-up, and only the caller knows
      // which groups exist beyond the ones being drawn right now.
      groupOrder: groupOrderFor(documents),
      title: graphTitle(id),
    });

    const target = outputPath ?? defaultOutputPath(id);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, html, "utf-8");

    return textResponse(wroteGraphMessage({ target, nodes: graph.nodes, edges: graph.edges }));
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

/** Both directions, because being referenced is as much a relation as referencing. */
function relate(params: { adjacency: Map<string, Set<string>>; from: string; to: string }): void {
  const { adjacency, from, to } = params;

  for (const [a, b] of [[from, to], [to, from]] as const) {
    const neighbours = adjacency.get(a) ?? new Set<string>();
    neighbours.add(b);
    adjacency.set(a, neighbours);
  }
}

/**
 * Every relation in the corpus, before any filtering. Undirected adjacency is
 * kept alongside so a neighbourhood can be walked in both directions.
 */
function relations(documents: MarkdownSummary[]): {
  allEdges: GraphEdge[];
  adjacency: Map<string, Set<string>>;
} {
  const allEdges: GraphEdge[] = documents.flatMap((doc) =>
    (doc.relatedDocs ?? []).map((target) => ({ source: doc.id, target })),
  );

  const adjacency = new Map<string, Set<string>>();
  for (const edge of allEdges) {
    relate({ adjacency, from: edge.source, to: edge.target });
  }

  return { allEdges, adjacency };
}

/** Whether a document has a relation in either direction. */
function isLinked(params: { docId: string; adjacency: Map<string, Set<string>> }): boolean {
  const { docId, adjacency } = params;
  return (adjacency.get(docId)?.size ?? 0) > 0;
}

/** Ids that are referenced but are not documents. */
function danglingTargets(params: { allEdges: GraphEdge[]; known: Set<string> }): string[] {
  const { allEdges, known } = params;
  return allEdges.filter((edge) => !known.has(edge.target)).map((edge) => edge.target);
}

/** The whole corpus, plus the ids it references that are not in it. */
function allIncluded(params: {
  documents: MarkdownSummary[];
  adjacency: Map<string, Set<string>>;
  includeUnlinked: boolean;
  allEdges: GraphEdge[];
  known: Set<string>;
}): Set<string> {
  const { documents, adjacency, includeUnlinked, allEdges, known } = params;

  const drawn = documents
    .filter((doc) => includeUnlinked || isLinked({ docId: doc.id, adjacency }))
    .map((doc) => doc.id);

  return new Set([...drawn, ...danglingTargets({ allEdges, known })]);
}

/**
 * A referenced id that is not a document, drawn as its own shape so the gap is
 * visible rather than inferred from an id that appears only as a target.
 */
function missingNode(nodeId: string): GraphNode {
  return {
    id: nodeId,
    label: nodeId,
    group: MISSING_GROUP,
    shape: "diamond" as const,
    tooltip: `${nodeId} — referenced but does not exist`,
  };
}

/**
 * A document whose description was never written carries the placeholder `list`
 * shows, not an empty string -- so testing for `""` here left every such node
 * tooltipped `id — (No description)`, which says less than the id on its own.
 */
function documentNode(params: { doc: MarkdownSummary; linked: boolean }): GraphNode {
  const { doc, linked } = params;

  return {
    id: doc.id,
    label: doc.id,
    group: linked ? groupOf(doc.id) : ORPHAN_GROUP,
    tooltip: isDescriptionMissing(doc) ? doc.id : `${doc.id} — ${doc.description}`,
  };
}

export function buildGraph(params: {
  documents: MarkdownSummary[];
  focusId?: string;
  depth: number;
  includeUnlinked: boolean;
}): Graph {
  const { documents, focusId, depth, includeUnlinked } = params;

  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const known = new Set(byId.keys());

  const { allEdges, adjacency } = relations(documents);

  const included = focusId === undefined
    ? allIncluded({ documents, adjacency, includeUnlinked, allEdges, known })
    : neighbourhood({ focusId, adjacency, depth });

  const edges = allEdges.filter((edge) => included.has(edge.source) && included.has(edge.target));

  const nodes: GraphNode[] = [...included].map((nodeId) => {
    const doc = byId.get(nodeId);
    if (doc === undefined) return missingNode(nodeId);
    return documentNode({ doc, linked: isLinked({ docId: nodeId, adjacency }) });
  });

  // Sorted so the same corpus produces the same page, which makes two renders
  // comparable and keeps the layout from reshuffling between runs.
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => `${a.source}\u0000${a.target}`.localeCompare(`${b.source}\u0000${b.target}`));

  return { nodes, edges };
}

/** A node with no relations has no adjacency entry, rather than an empty one. */
function neighboursOf(params: {
  nodeId: string;
  adjacency: Map<string, Set<string>>;
}): Iterable<string> {
  const { nodeId, adjacency } = params;
  return adjacency.get(nodeId) ?? [];
}

/** Marks what it returns as reached, so a hop never revisits an earlier one. */
function unreachedNeighbours(params: {
  nodeId: string;
  adjacency: Map<string, Set<string>>;
  reached: Set<string>;
}): string[] {
  const { nodeId, adjacency, reached } = params;

  const found: string[] = [];
  for (const neighbour of neighboursOf({ nodeId, adjacency })) {
    if (reached.has(neighbour)) continue;
    reached.add(neighbour);
    found.push(neighbour);
  }

  return found;
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
    frontier = frontier.flatMap((nodeId) => unreachedNeighbours({ nodeId, adjacency, reached }));
    if (frontier.length === 0) break;
  }

  return reached;
}

/**
 * Every group the mapping can produce, in the order colours are handed out.
 *
 * Derived from the whole corpus rather than from the nodes being drawn,
 * because the colour of a group must not depend on which others happen to
 * appear: without this, `every-task` came out purple in the corpus graph and
 * orange in a close-up of one document.
 *
 * The two sentinel groups are listed even though most graphs contain neither.
 * A name the list omits falls in behind the ones it holds, which settles the
 * order between views holding the same groups but not between views where one
 * is absent -- and appearing only sometimes is exactly what these two do.
 */
function groupOrderFor(documents: MarkdownSummary[]): string[] {
  const groups = new Set(documents.map((doc) => groupOf(doc.id)));
  return [...[...groups].sort(), MISSING_GROUP, ORPHAN_GROUP];
}

/** Targets per source, so the adjacency list has one line per referencing document. */
function outgoingBySource(edges: GraphEdge[]): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  return outgoing;
}

/** `(nothing)` rather than a blank, so an empty answer still reads as an answer. */
function idList(ids: string[]): string {
  return ids.length === 0 ? "(nothing)" : ids.join(", ");
}

/**
 * The two questions actually being asked of a focused graph -- what points here,
 * and what does this point at -- answered on their own lines, so neither has to
 * be recovered by scanning the adjacency list.
 */
function focusSection(params: {
  focusId: string;
  depth: number;
  edges: GraphEdge[];
  outgoing: Map<string, string[]>;
}): string {
  const { focusId, depth, edges, outgoing } = params;
  const referencedBy = edges.filter((e) => e.target === focusId).map((e) => e.source);
  const references = outgoing.get(focusId) ?? [];

  return `${focusId}, depth ${depth}

referenced by: ${idList(referencedBy)}
references: ${idList(references)}`;
}

/** A sentinel group, named outright, or nothing when the graph has no members of it. */
function groupSection(params: { nodes: GraphNode[]; group: string; heading: string }): string[] {
  const { nodes, group, heading } = params;

  const members = nodes.filter((node) => node.group === group);
  if (members.length === 0) return [];

  return [`${heading}: ${members.map((n) => n.id).join(", ")}`];
}

/**
 * The same graph the page draws, written out for a caller that cannot open one.
 *
 * An adjacency list carries the whole structure in the fewest tokens: one line
 * per document that references anything, direction preserved.
 */
function formatGraphAsText(params: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusId?: string;
  depth: number;
}): string {
  const { nodes, edges, focusId, depth } = params;
  const outgoing = outgoingBySource(edges);

  const sections: string[] = [
    focusId === undefined
      ? `${nodes.length} documents, ${edges.length} relations`
      : focusSection({ focusId, depth, edges, outgoing }),
    [...outgoing.entries()].map(([source, targets]) => `${source} -> ${targets.join(", ")}`).join("\n"),
    ...groupSection({
      nodes,
      group: MISSING_GROUP,
      heading: "missing (referenced but not present)",
    }),
    ...groupSection({
      nodes,
      group: ORPHAN_GROUP,
      heading: "unlinked (no relations either way)",
    }),
  ];

  return sections.join("\n\n");
}

function nothingRequested(params: {
  layout?: LayoutName;
  direction?: LayoutDirection;
  spacing?: number;
}): boolean {
  const { layout, direction, spacing } = params;
  return layout === undefined && direction === undefined && spacing === undefined;
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
  if (nothingRequested(params)) return undefined;

  return { name: layout, direction, spacing };
}

function defaultOutputPath(focusId?: string): string {
  const name = focusId === undefined ? "corpus" : encodeURIComponent(focusId);
  return path.join(os.tmpdir(), GRAPH_BASE, `${name}-${Date.now()}.html`);
}
