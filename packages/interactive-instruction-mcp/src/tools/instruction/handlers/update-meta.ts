import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { DRAFT_DIR } from "../../../constants.js";
import type { MarkdownSummary } from "../../../types/index.js";
import { parseFrontmatter } from "../../../utils/frontmatter-parser.js";
import { buildGraph } from "./graph.js";

const schema = z.object({
  action: z.literal("update_meta"),
  id: z.string().describe("Document ID to update metadata for"),
});

type Args = z.infer<typeof schema>;

/** How many same-category documents to offer as relation candidates. */
const MAX_CANDIDATES = 12;

/**
 * What the corpus already knows about where a document sits.
 *
 * A description written while looking at one document alone drifts: two
 * documents end up claiming the same ground, or one is pitched at a different
 * altitude from its neighbours. What the corpus says about the neighbourhood is
 * the context that prevents that, and `relatedDocs` being frontmatter rather
 * than prose is what makes it available as data -- the same mapping `graph`
 * draws is the one read here.
 */
export function buildNeighbourhood(params: {
  id: string;
  documents: MarkdownSummary[];
}): { related: MarkdownSummary[]; candidates: MarkdownSummary[]; category: string } {
  const { id, documents } = params;
  const byId = new Map(documents.map((doc) => [doc.id, doc]));

  const { nodes } = buildGraph({
    documents,
    focusId: id,
    depth: 1,
    includeUnlinked: false,
  });

  const related = nodes
    .filter((node) => node.id !== id)
    .map((node) => byId.get(node.id))
    .filter((doc): doc is MarkdownSummary => doc !== undefined);

  const separatorIndex = id.indexOf("__");
  const category = separatorIndex === -1 ? id : id.slice(0, separatorIndex);

  // Only offered when the document has no relations at all. With neighbours
  // already in hand, a list of everything nearby is noise; without them, it is
  // the only material for deciding where this document belongs -- and the
  // documents whose metadata most needs work are exactly the unlinked ones.
  const candidates =
    related.length > 0
      ? []
      : documents
          .filter((doc) => doc.id !== id)
          .filter((doc) => doc.id.startsWith(`${category}__`))
          .slice(0, MAX_CANDIDATES);

  return { related, candidates, category };
}

export class UpdateMetaHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "update_meta";
  readonly help =
    "Gather what the corpus knows about a document -- its own metadata, its neighbours, and where it might belong -- and ask for better metadata.";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id } = params.args;
    const { reader } = params.context;

    const content = await reader.getDocumentContent(id);
    if (content === null) {
      return errorResponse(`Error: Document "${id}" not found.` +
        formatNextActions([{
          action: "list",
          description: "View all documents",
          example: `instruction(action: "list")`,
        }]));
    }

    const listed = await reader.listDocuments({ recursive: true });
    const documents = listed.documents.filter((doc) => !doc.id.startsWith(DRAFT_DIR));
    const { related, candidates, category } = buildNeighbourhood({ id, documents });

    const frontmatter = parseFrontmatter(content);

    const sections = [
      `# Metadata review: ${id}`,
      "",
      "## What it says now",
      `- **description**: ${frontmatter.description ?? "(not set)"}`,
      `- **whenToUse**: ${formatList(frontmatter.whenToUse)}`,
      `- **relatedDocs**: ${formatList(frontmatter.relatedDocs)}`,
      "",
      neighbourhoodSection({ related, candidates, category }),
      "",
      "## What to write",
      "",
      "**description** — one or two sentences on what this document is for. Third",
      "person, under 150 characters. It has to distinguish this document from the",
      "ones listed above; if it cannot, the two probably want merging.",
      "",
      "**whenToUse** — 2 to 5 phrases naming the situation that should send someone",
      "here. Name the trigger, not the topic.",
    ];

    if (candidates.length > 0) {
      sections.push(
        "",
        "**relatedDocs** — this document is linked to nothing. Links run one way, from",
        "the document that gives an overview to the one that holds the detail. If one of",
        "the documents above is the hub this belongs under, add this document to that",
        "hub's `relatedDocs` rather than the reverse. If it genuinely stands alone,",
        "leave it unlinked -- an invented link is worse than none."
      );
    }

    sections.push(
      "",
      "## Applying it",
      "",
      "`update` takes the metadata on its own; the body does not have to be resent:",
      "",
      "```",
      `instruction(action: "update", id: "${id}", description: "...", whenToUse: ["...", "..."])`,
      "```"
    );

    return textResponse(
      sections.join("\n") +
        formatNextActions([
          {
            action: "update",
            description: "Write the new metadata, leaving the body alone",
            example: `instruction(action: "update", id: "${id}", description: "...", whenToUse: ["..."])`,
          },
          {
            action: "read",
            description: "Read the document before deciding",
            example: `instruction(action: "read", id: "${id}")`,
          },
        ])
    );
  }
}

function formatList(values: string[] | undefined): string {
  return values === undefined || values.length === 0 ? "(not set)" : values.join(", ");
}

function describe(doc: MarkdownSummary): string {
  return `- \`${doc.id}\` — ${doc.description || "(no description)"}`;
}

function neighbourhoodSection(params: {
  related: MarkdownSummary[];
  candidates: MarkdownSummary[];
  category: string;
}): string {
  const { related, candidates, category } = params;

  if (related.length > 0) {
    return [
      "## What it sits next to",
      "",
      "Documents one hop away, in either direction. A description that could equally",
      "describe one of these is too vague.",
      "",
      ...related.map(describe),
    ].join("\n");
  }

  if (candidates.length > 0) {
    return [
      "## Where it might belong",
      "",
      `Nothing links to or from this document. Others under \`${category}\`:`,
      "",
      ...candidates.map(describe),
    ].join("\n");
  }

  return [
    "## Where it might belong",
    "",
    "Nothing links to or from this document, and nothing else shares its category.",
    "It may be the first of its kind, or it may want a different id.",
  ].join("\n");
}
