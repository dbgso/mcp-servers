import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { DRAFT_PREFIX, isInternalDocument } from "../../../constants.js";
import type { DocumentFrontmatter, MarkdownSummary } from "../../../types/index.js";
import { parseFrontmatter } from "../../../utils/frontmatter-parser.js";
import { frontmatterErrors, rawFrontmatter } from "../../../utils/frontmatter-parser.js";
import { buildGraph } from "./graph.js";
import {
  isDescriptionMissing,
  MISSING_DESCRIPTION_PLACEHOLDER,
} from "../../../services/metadata-completeness.js";

const schema = z.object({
  action: z.literal("read_meta"),
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

export class ReadMetaHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "read_meta";
  readonly help =
    "Read a document's metadata, and what the corpus knows about where it sits: its neighbours, and where it might belong. " +
    "`read` answers with prose alone, so this is where metadata is read -- for a draft as well as a promoted document. " +
    "Writes nothing: it ends with the `update` call that would apply better metadata.";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id } = params.args;
    const { reader } = params.context;

    const found = await loadForReview({ reader, id });
    if (found === null) {
      return errorResponse(`Error: Document "${id}" not found.` +
        formatNextActions([{
          action: "list",
          description: "View all documents",
          example: `instruction(action: "list")`,
        }]));
    }

    // A block that did not parse reads as absent everywhere else, so this is the
    // one place that can still show it. `read` hides frontmatter by design, and
    // without this the caller is told their YAML is wrong at line 1 column 14 and
    // has no way to look at line 1 -- which is the state this refusal left them
    // in until it was noticed.
    const unreadable = frontmatterErrors(found.content);
    if (unreadable.length > 0) {
      return textResponse(
        `# Metadata review: ${draftMarker(found.isDraft)}${id}\n\n` +
        `## The frontmatter cannot be read\n\n` +
        `${unreadable[0]}\n\n` +
        "Nothing below it is being read, so this document has no description, no " +
        "`whenToUse` and no `relatedDocs` as far as every other action is " +
        "concerned -- whatever the file says. A value containing `: ` has to be " +
        "quoted, which is the usual cause.\n\n" +
        "## What is in the file\n\n" +
        "```yaml\n" + rawFrontmatter(found.content) + "\n```\n\n" +
        "This has to be repaired in the file itself: a write cannot keep what it " +
        "cannot parse, so `update` refuses rather than dropping it." +
        formatNextActions([{
          action: "lint",
          description: "See whether anything else in the corpus is in this state",
          example: `instruction(action: "lint")`,
        }]));
    }

    const listed = await reader.listDocuments({ recursive: true });
    const documents = listed.documents.filter((doc) => !isInternalDocument(doc.id));

    return textResponse(
      reviewSections({
        id,
        isDraft: found.isDraft,
        frontmatter: parseFrontmatter(found.content),
        neighbourhood: buildNeighbourhood({ id, documents }),
      }).join("\n") +
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

/**
 * A draft is looked up under its prefix when there is no promoted document by
 * that id. `read` answers with prose alone and `list` names a draft without its
 * metadata, so this is the only way to see what a draft's metadata currently
 * says -- which is exactly when it most needs work.
 */
async function loadForReview(params: {
  reader: InstructionContext["reader"];
  id: string;
}): Promise<{ content: string; isDraft: boolean } | null> {
  const { reader, id } = params;

  const promoted = await reader.getDocumentContent(id);
  if (promoted !== null) return { content: promoted, isDraft: false };

  const draft = await reader.getDocumentContent(DRAFT_PREFIX + id);
  if (draft === null) return null;
  return { content: draft, isDraft: true };
}

/** A draft's review must not read as the promoted document's. */
function draftMarker(isDraft: boolean): string {
  return isDraft ? "**[Draft]** " : "";
}

/**
 * Offered only when the document is linked to nothing: with neighbours already
 * listed, advice on how to link is noise.
 */
const LINKING_GUIDANCE = [
  "",
  "**relatedDocs** — this document is linked to nothing. Links run one way, from",
  "the document that gives an overview to the one that holds the detail. If one of",
  "the documents above is the hub this belongs under, add this document to that",
  "hub's `relatedDocs` rather than the reverse. If it genuinely stands alone,",
  "leave it unlinked -- an invented link is worse than none.",
];

function applyingSection(id: string): string[] {
  return [
    "",
    "## Applying it",
    "",
    "`update` takes the metadata on its own; the body does not have to be resent:",
    "",
    "```",
    `instruction(action: "update", id: "${id}", description: "...", whenToUse: ["...", "..."])`,
    "```",
  ];
}

function reviewSections(params: {
  id: string;
  isDraft: boolean;
  frontmatter: DocumentFrontmatter;
  neighbourhood: ReturnType<typeof buildNeighbourhood>;
}): string[] {
  const { id, isDraft, frontmatter, neighbourhood } = params;
  const { related, candidates, category } = neighbourhood;

  return [
    `# Metadata review: ${draftMarker(isDraft)}${id}`,
    "",
    "## What it says now",
    `- **description**: ${frontmatter.description ?? "(not set)"}`,
    `- **whenToUse**: ${formatList(frontmatter.whenToUse)}`,
    `- **relatedDocs**: ${formatList(frontmatter.relatedDocs)}`,
    ...recordedSection(frontmatter),
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
    ...(candidates.length > 0 ? LINKING_GUIDANCE : []),
    ...applyingSection(id),
  ];
}

/**
 * The fields the tools wrote, kept apart from the ones the caller is being
 * asked to write.
 *
 * `approvedAt` is a record, not a setting: `approve` stamps it when the
 * document enters the corpus. Listing it beside `description` would read as an
 * invitation to set it. It is reported here because a value written into
 * someone's file with no way to read it back is worse than not writing it --
 * and `read` answers with prose now, so this is the only place it surfaces.
 *
 * `sizeExemption` is the caller's, but it is written for `lint` rather than
 * for navigation, and `lint` is where it is discussed. It is shown so that
 * the answer to "what does this document's frontmatter say" is complete.
 */
function recordedSection(frontmatter: DocumentFrontmatter): string[] {
  const lines = [
    recordedLine({ label: "sizeExemption", value: frontmatter.sizeExemption }),
    recordedLine({ label: "approvedAt", value: frontmatter.approvedAt, note: "recorded on promotion" }),
  ].filter((line): line is string => line !== null);

  if (lines.length === 0) return [];
  return ["", "## Also recorded", ...lines];
}

/** Nothing at all when the field was never written: an empty value is not a record. */
function recordedLine(params: { label: string; value: string | undefined; note?: string }): string | null {
  const { label, value, note } = params;

  if (value === undefined) return null;
  if (note === undefined) return `- **${label}**: ${value}`;
  return `- **${label}**: ${value} (${note})`;
}

function describe(doc: MarkdownSummary): string {
  // The same placeholder `list` and `lint` use. Testing for an empty string
  // here printed `— (No description)`, since a document whose description was
  // never written already carries the placeholder by the time it is listed.
  const summary = isDescriptionMissing(doc) ? MISSING_DESCRIPTION_PLACEHOLDER : doc.description;
  return `- \`${doc.id}\` — ${summary}`;
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
