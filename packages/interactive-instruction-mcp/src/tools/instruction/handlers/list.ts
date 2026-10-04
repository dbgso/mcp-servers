import { z } from "zod";
import { BaseActionHandler, looseBoolean, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import {
  errorResponse,
  formatNextActions,
  textResponse,
  type NextActionSuggestion,
} from "../types.js";
import { DRAFT_PREFIX, isInternalDocument } from "../../../constants.js";
import { draftWorkflowManager, type DraftState } from "../../../workflows/draft-workflow.js";
import type { MarkdownSummary } from "../../../types/index.js";
import {
  isDescriptionMissing,
  isWhenToUseMissing,
} from "../../../services/metadata-completeness.js";

const listSchema = z.object({
  action: z.literal("list"),
  id: z.string().optional().describe("Parent ID to list documents under"),
  recursive: looseBoolean(z.boolean().optional().default(false).describe("Include nested documents")),
  query: z.string().optional().describe("Search by description or whenToUse"),
  missingMeta: z.enum(["description", "whenToUse", "any"]).optional()
    .describe("Find documents with missing metadata"),
  drafts: looseBoolean(z.boolean().optional().describe("List drafts instead of promoted documents")),
});

type ListArgs = z.infer<typeof listSchema>;

type MissingMeta = NonNullable<ListArgs["missingMeta"]>;

/** What the reader hands back, and what the draft filter reshapes. */
type Listing = {
  documents: MarkdownSummary[];
  categories: { id: string; docCount: number }[];
};

/** Nothing has been drafted yet, so the only move left to offer is making one. */
const CREATE_DRAFT: NextActionSuggestion = {
  action: "add",
  description: "Create a new draft",
  example: 'instruction(action: "add", id: "new-doc", content: "...", description: "...", whenToUse: [...])',
};

function reviewReminderDescription(count: number): string {
  if (count === 1) return "Record the self-review this draft still needs";
  return `Record the self-review each of these ${count} still needs, one at a time`;
}

function reviewReminder(unreviewed: string[]): NextActionSuggestion[] {
  if (unreviewed.length === 0) return [];

  return [{
    action: "approve",
    description: reviewReminderDescription(unreviewed.length),
    example: `instruction(action: "approve", id: "${unreviewed[0]}", notes: "<self-review>")`,
  }];
}

/** One reviewed draft is promoted by `id`, several by `ids` under one explanation. */
function promotionOffer(ready: string[]): NextActionSuggestion[] {
  if (ready.length === 0) return [];

  if (ready.length === 1) {
    return [{
      action: "approve",
      description: "Promote the one that has been reviewed",
      example: `instruction(action: "approve", id: "${ready[0]}", explanation: "<what it says and why>")`,
    }];
  }

  return [{
    action: "approve",
    description: `Promote the ${ready.length} that have been reviewed, under one explanation`,
    example: `instruction(action: "approve", ids: "${ready.join(",")}", explanation: "<what these say and why>")`,
  }];
}

/**
 * What to offer after listing drafts, given what each of them is ready for.
 *
 * `approve(ids:)` only appears when a batch of them would go through.
 */
function draftNextActions(params: { ready: string[]; unreviewed: string[] }): NextActionSuggestion[] {
  const { ready, unreviewed } = params;

  if (ready.length === 0 && unreviewed.length === 0) return [CREATE_DRAFT];

  return [...reviewReminder(unreviewed), ...promotionOffer(ready)];
}

/** `editing` is what a draft the workflow has recorded nothing for counts as. */
async function draftState(id: string): Promise<DraftState> {
  const status = await draftWorkflowManager.getStatus({ id });
  return status?.state ?? "editing";
}

/** The states `approve` promotes from; every other one still owes a self-review. */
function isReviewed(state: DraftState): boolean {
  return state === "user_reviewing" || state === "pending_approval";
}

/**
 * Split the drafts by what `approve` will actually accept.
 *
 * A batch promotion refuses unless every draft in it has had its self-review
 * recorded, so offering `ids: "<all of them>"` straight after `add` -- the
 * commonest case, and the one this listing exists for -- hands back a call the
 * server rejects.
 */
async function splitByReadiness(ids: string[]): Promise<{ ready: string[]; unreviewed: string[] }> {
  const ready: string[] = [];
  const unreviewed: string[] = [];

  for (const id of ids) {
    if (isReviewed(await draftState(id))) ready.push(id);
    else unreviewed.push(id);
  }

  return { ready, unreviewed };
}

/** The body of a draft listing: how many, which, and what is still owed. */
function draftListingText(params: {
  documents: MarkdownSummary[];
  unreviewed: string[];
  reader: InstructionContext["reader"];
}): string {
  const { documents, unreviewed, reader } = params;
  if (documents.length === 0) return "No drafts.";

  const listed = `${documents.length} draft(s):\n\n${reader.formatDocumentList({ documents, categories: [] })}`;
  if (unreviewed.length === 0) return listed;

  return `${listed}\nAwaiting self-review: ${unreviewed.join(", ")}`;
}

async function draftListing(params: {
  documents: MarkdownSummary[];
  reader: InstructionContext["reader"];
}): Promise<ToolResponse> {
  const { documents, reader } = params;
  const { ready, unreviewed } = await splitByReadiness(documents.map((doc) => doc.id));

  return textResponse(
    draftListingText({ documents, unreviewed, reader }) +
    formatNextActions(draftNextActions({ ready, unreviewed })),
  );
}

/**
 * Which documents this listing is about.
 *
 * The default is the corpus: a listing of what has been written, not of what is
 * being written. `drafts: true` asks for the other set, by the plain id --
 * `approve` and `set_status` both take a batch of ids, and until now there was
 * no call that produced one.
 */
function filterDrafts(params: { result: Listing; drafts: boolean }): Listing {
  const { result, drafts } = params;

  if (drafts) {
    return {
      documents: result.documents
        .filter((d) => d.id.startsWith(DRAFT_PREFIX))
        .map((d) => ({ ...d, id: d.id.slice(DRAFT_PREFIX.length) })),
      categories: [],
    };
  }
  return {
    documents: result.documents.filter((d) => !isInternalDocument(d.id)),
    categories: result.categories.filter((c) => !isInternalDocument(c.id)),
  };
}

/** `whenToUse` is optional, so a document without it matches on its other text. */
function whenToUseMatches(params: { doc: MarkdownSummary; lowerQuery: string }): boolean {
  const { doc, lowerQuery } = params;
  return doc.whenToUse?.some((w) => w.toLowerCase().includes(lowerQuery)) === true;
}

/**
 * Whether a document answers the query.
 *
 * Includes id so locale-mismatched queries (e.g. English term against a
 * Japanese description) still hit when the filename carries the keyword.
 */
function matchesQuery(params: { doc: MarkdownSummary; q: string }): boolean {
  const { doc, q } = params;
  const lowerQuery = q.toLowerCase();
  if (doc.id.toLowerCase().includes(lowerQuery)) return true;
  if (doc.description.toLowerCase().includes(lowerQuery)) return true;
  return whenToUseMatches({ doc, lowerQuery });
}

function isAnyMetaMissing(doc: MarkdownSummary): boolean {
  return isDescriptionMissing(doc) || isWhenToUseMissing(doc);
}

/**
 * What each `missingMeta` filter asks about.
 *
 * A total map rather than a switch, so adding a value to the schema is a
 * compile error here until it has an answer.
 *
 * Shared with `lint`, which is the other half of this question. Checking for an
 * empty string here missed every document the reader had given the
 * `(No description)` placeholder to -- which is all of the ones `lint` reports.
 */
const MISSING_META_TESTS: Record<MissingMeta, (doc: MarkdownSummary) => boolean> = {
  description: isDescriptionMissing,
  whenToUse: isWhenToUseMissing,
  any: isAnyMetaMissing,
};

/** Whether the arguments ask for a search rather than a listing of a place. */
function isSearch(params: { query?: string; missingMeta?: MissingMeta }): boolean {
  return Boolean(params.query || params.missingMeta);
}

function searchHeader(params: { query?: string; missingMeta?: MissingMeta }): string {
  const { query, missingMeta } = params;
  const headerParts: string[] = [];
  if (query) headerParts.push(`query: "${query}"`);
  if (missingMeta) headerParts.push(`missing: ${missingMeta}`);
  return `Search results (${headerParts.join(", ")})`;
}

/** Both filters narrow the same set, and giving both means giving both. */
function searchResults(params: {
  documents: MarkdownSummary[];
  query?: string;
  missingMeta?: MissingMeta;
}): MarkdownSummary[] {
  const { documents, query, missingMeta } = params;

  let found = documents;
  if (query) found = found.filter((d) => matchesQuery({ doc: d, q: query }));
  if (missingMeta) found = found.filter((d) => MISSING_META_TESTS[missingMeta](d));
  return found;
}

/** The wording of the refusal, kept apart so the decision above it stays readable. */
function draftFilterRefusal(conflicting: string[]): string {
  return (
    `\`drafts: true\` lists every draft and takes no other filter, but ${conflicting.join(", ")} ${conflicting.length === 1 ? "was" : "were"} given.` +
    formatNextActions([
      {
        action: "list",
        description: "List the drafts",
        example: 'instruction(action: "list", drafts: true)',
      },
      {
        action: "list",
        description: "Search the promoted corpus instead",
        example: 'instruction(action: "list", query: "<term>")',
      },
    ]));
}

/**
 * `drafts: true` combined with any other filter, refused rather than answered.
 *
 * `drafts` reaches its own branch last, and the filter it changes is shared by
 * the ones before it -- so combining it with a search or a category silently
 * reshaped those instead of being ignored, and `list(drafts: true, id: "cat")`
 * answered "no documents" about a category that has drafts in it. A wrong
 * answer is worse than a refused one.
 */
function refuseDraftFilters(args: ListArgs): ToolResponse | null {
  const { id, query, missingMeta, drafts } = args;
  if (drafts !== true) return null;

  const conflicting = [
    ["id", id !== undefined],
    ["query", query !== undefined],
    ["missingMeta", missingMeta !== undefined],
  ].filter(([, given]) => given).map(([name]) => name as string);

  if (conflicting.length === 0) return null;

  return errorResponse(draftFilterRefusal(conflicting));
}

export class ListHandler extends BaseActionHandler<ListArgs, InstructionContext> {
  readonly action = "list";
  readonly help = `List documents.

Usage:
- \`instruction(action: "list")\` - List root documents
- \`instruction(action: "list", recursive: true)\` - List all documents
- \`instruction(action: "list", id: "category")\` - List documents in category
- \`instruction(action: "list", query: "search term")\` - Search documents
- \`instruction(action: "list", missingMeta: "any")\` - Find docs with missing metadata
- \`instruction(action: "list", drafts: true)\` - List drafts, by the plain id every other action takes`;

  readonly schema = listSchema;

  protected async doExecute(params: {
    args: ListArgs;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { args, context } = params;

    // Ahead of the dispatch, because the filters it rejects are the ones that
    // choose a listing: refusing afterwards would mean answering as that
    // listing first.
    const refusal = refuseDraftFilters(args);
    if (refusal !== null) return refusal;

    return this.listing({ args, reader: context.reader });
  }

  /** Which of the three listings the arguments ask for. */
  private listing(params: {
    args: ListArgs;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { args, reader } = params;

    if (isSearch(args)) return this.searchListing({ args, reader });

    const { id } = args;
    if (id) return this.categoryListing({ args, reader, id });

    return this.rootListing({ args, reader });
  }

  private async searchListing(params: {
    args: ListArgs;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { args, reader } = params;
    const { id, query, missingMeta, drafts } = args;

    const result = await reader.listDocuments({
      parentId: id || undefined,
      recursive: true,
    });
    const { documents } = filterDrafts({ result, drafts: drafts === true });
    const found = searchResults({ documents, query, missingMeta });

    return textResponse(
      `${searchHeader({ query, missingMeta })}: ${found.length} found\n\n` +
      reader.formatDocumentList({ documents: found, categories: [] }) +
      formatNextActions([
        {
          action: "read",
          description: "Read a specific document",
          example: 'instruction(action: "read", id: "<doc-id>")',
        },
      ]),
    );
  }

  private async categoryListing(params: {
    args: ListArgs;
    reader: InstructionContext["reader"];
    id: string;
  }): Promise<ToolResponse> {
    const { args, reader, id } = params;

    const isCategory = await reader.isCategory(id);
    if (isCategory) {
      const result = await reader.listDocuments({ parentId: id, recursive: args.recursive });
      const { documents, categories } = filterDrafts({ result, drafts: args.drafts === true });

      return textResponse(
        `Category: ${id}\n\n` +
        reader.formatDocumentList({ documents, categories }) +
        formatNextActions([
          {
            action: "read",
            description: "Read a document",
            example: `instruction(action: "read", id: "<doc-id>")`,
          },
          {
            action: "add",
            description: "Create a new draft in this category",
            example: `instruction(action: "add", id: "${id}__new-doc", content: "...", description: "...", whenToUse: [...])`,
          },
        ]),
      );
    }

    // ID is not a category - suggest read instead
    return errorResponse(
      `"${id}" is not a category. To read this document:\n\n\`instruction(action: "read", id: "${id}")\``,
    );
  }

  private async rootListing(params: {
    args: ListArgs;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { args, reader } = params;
    const { recursive, drafts } = args;

    // Drafts are nested under their own directory, so asking for them has to
    // descend whatever the caller said about the corpus.
    const result = await reader.listDocuments({ recursive: recursive || drafts === true });
    const { documents, categories } = filterDrafts({ result, drafts: drafts === true });

    if (drafts === true) return draftListing({ documents, reader });

    return textResponse(
      reader.formatDocumentList({ documents, categories }) +
      formatNextActions([
        {
          action: "read",
          description: "Read a specific document",
          example: 'instruction(action: "read", id: "<doc-id>")',
        },
        {
          action: "add",
          description: "Create a new draft",
          example: 'instruction(action: "add", id: "new-doc", content: "...", description: "...", whenToUse: [...])',
        },
        {
          action: "list",
          description: "List all documents including nested",
          example: 'instruction(action: "list", recursive: true)',
        },
      ]),
    );
  }
}
