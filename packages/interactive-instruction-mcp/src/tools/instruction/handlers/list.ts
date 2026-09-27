import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, type NextActionSuggestion } from "../types.js";
import { DRAFT_PREFIX, isInternalDocument } from "../../../constants.js";
import { draftWorkflowManager } from "../../../workflows/draft-workflow.js";
import type { MarkdownSummary } from "../../../types/index.js";
import {
  isDescriptionMissing,
  isWhenToUseMissing,
} from "../../../services/metadata-completeness.js";

const listSchema = z.object({
  action: z.literal("list"),
  id: z.string().optional().describe("Parent ID to list documents under"),
  recursive: z.boolean().optional().default(false).describe("Include nested documents"),
  query: z.string().optional().describe("Search by description or whenToUse"),
  missingMeta: z.enum(["description", "whenToUse", "any"]).optional()
    .describe("Find documents with missing metadata"),
  backlinks: z.boolean().optional().describe("Find documents referencing this ID. Requires `id`"),
  drafts: z.boolean().optional().describe("List drafts instead of promoted documents"),
});

type ListArgs = z.infer<typeof listSchema>;

/**
 * What to offer after listing drafts, given what each of them is ready for.
 *
 * `approve(ids:)` only appears when a batch of them would go through.
 */
function draftNextActions(params: { ready: string[]; unreviewed: string[] }): NextActionSuggestion[] {
  const { ready, unreviewed } = params;

  if (ready.length === 0 && unreviewed.length === 0) {
    return [{
      action: "add",
      description: "Create a new draft",
      example: 'instruction(action: "add", id: "new-doc", content: "...", description: "...", whenToUse: [...])',
    }];
  }

  const suggestions: NextActionSuggestion[] = [];

  if (unreviewed.length > 0) {
    suggestions.push({
      action: "approve",
      description:
        unreviewed.length === 1
          ? "Record the self-review this draft still needs"
          : `Record the self-review each of these ${unreviewed.length} still needs, one at a time`,
      example: `instruction(action: "approve", id: "${unreviewed[0]}", notes: "<self-review>")`,
    });
  }

  if (ready.length > 1) {
    suggestions.push({
      action: "approve",
      description: `Promote the ${ready.length} that have been reviewed, under one explanation`,
      example: `instruction(action: "approve", ids: "${ready.join(",")}", explanation: "<what these say and why>")`,
    });
  } else if (ready.length === 1) {
    suggestions.push({
      action: "approve",
      description: "Promote the one that has been reviewed",
      example: `instruction(action: "approve", id: "${ready[0]}", explanation: "<what it says and why>")`,
    });
  }

  return suggestions;
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
    const state = (await draftWorkflowManager.getStatus({ id }))?.state ?? "editing";
    if (state === "user_reviewing" || state === "pending_approval") ready.push(id);
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

  return {
    content: [
      {
        type: "text" as const,
        text:
          draftListingText({ documents, unreviewed, reader }) +
          formatNextActions(draftNextActions({ ready, unreviewed })),
      },
    ],
  };
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
- \`instruction(action: "list", id: "doc-id", backlinks: true)\` - Find documents referencing this doc
  (\`backlinks\` needs \`id\`; on its own it is ignored)
- \`instruction(action: "list", drafts: true)\` - List drafts, by the plain id every other action takes`;

  readonly schema = listSchema;

  protected async doExecute(params: {
    args: ListArgs;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { args, context } = params;
    const { reader } = context;
    const { id, recursive, query, missingMeta, backlinks, drafts } = args;

    // `drafts` reaches its own branch last, and the filter it changes is shared
    // by the ones before it -- so combining it with a search or a category
    // silently reshaped those instead of being ignored, and
    // `list(drafts: true, id: "cat")` answered "no documents" about a category
    // that has drafts in it. A wrong answer is worse than a refused one.
    if (drafts === true) {
      const conflicting = [
        ["id", id !== undefined],
        ["query", query !== undefined],
        ["missingMeta", missingMeta !== undefined],
        ["backlinks", backlinks === true],
      ].filter(([, given]) => given).map(([name]) => name as string);

      if (conflicting.length > 0) {
        return errorResponse(
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
    }

    /**
     * Which documents this listing is about.
     *
     * The default is the corpus: a listing of what has been written, not of
     * what is being written. `drafts: true` asks for the other set, by the
     * plain id -- `approve` and `set_status` both take a batch of ids, and
     * until now there was no call that produced one.
     */
    const filterDrafts = (result: {
      documents: MarkdownSummary[];
      categories: { id: string; docCount: number }[];
    }) => {
      if (drafts === true) {
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
    };

    // Helper to check if document matches query.
    // Includes id so locale-mismatched queries (e.g. English term against a
    // Japanese description) still hit when the filename carries the keyword.
    const matchesQuery = (params: { doc: MarkdownSummary; q: string }): boolean => {
      const { doc, q } = params;
      const lowerQuery = q.toLowerCase();
      if (doc.id.toLowerCase().includes(lowerQuery)) return true;
      if (doc.description.toLowerCase().includes(lowerQuery)) return true;
      if (doc.whenToUse?.some((w) => w.toLowerCase().includes(lowerQuery))) return true;
      return false;
    };

    // Helper to check if document has missing metadata
    const hasMissingMeta = (params: {
      doc: MarkdownSummary;
      type: "description" | "whenToUse" | "any";
    }): boolean => {
      const { doc, type } = params;
      // Shared with `lint`, which is the other half of this question. Checking
      // for an empty string here missed every document the reader had given
      // the `(No description)` placeholder to -- which is all of the ones
      // `lint` reports.
      const noDescription = isDescriptionMissing(doc);
      const noWhenToUse = isWhenToUseMissing(doc);

      switch (type) {
        case "description":
          return noDescription;
        case "whenToUse":
          return noWhenToUse;
        case "any":
          return noDescription || noWhenToUse;
      }
    };

    // Backlinks mode
    if (backlinks && id) {
      const result = await reader.listDocuments({ recursive: true });
      const { documents } = filterDrafts(result);

      const referencingDocs = documents.filter((doc) =>
        doc.relatedDocs?.includes(id)
      );

      if (referencingDocs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No documents reference "${id}" in their relatedDocs.`,
            },
          ],
        };
      }

      const text =
        `Documents referencing "${id}": ${referencingDocs.length} found\n\n` +
        reader.formatDocumentList({ documents: referencingDocs, categories: [] });

      return {
        content: [{ type: "text" as const, text }],
      };
    }

    // Query or missingMeta mode
    if (query || missingMeta) {
      const result = await reader.listDocuments({
        parentId: id || undefined,
        recursive: true,
      });
      let { documents } = filterDrafts(result);

      if (query) {
        documents = documents.filter((d) => matchesQuery({ doc: d, q: query }));
      }
      if (missingMeta) {
        documents = documents.filter((d) => hasMissingMeta({ doc: d, type: missingMeta }));
      }

      const headerParts: string[] = [];
      if (query) headerParts.push(`query: "${query}"`);
      if (missingMeta) headerParts.push(`missing: ${missingMeta}`);
      const header = `Search results (${headerParts.join(", ")}): ${documents.length} found\n\n`;

      const nextActions = formatNextActions([
        {
          action: "read",
          description: "Read a specific document",
          example: 'instruction(action: "read", id: "<doc-id>")',
        },
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: header + reader.formatDocumentList({ documents, categories: [] }) + nextActions,
          },
        ],
      };
    }

    // Category listing
    if (id) {
      const isCategory = await reader.isCategory(id);
      if (isCategory) {
        const result = await reader.listDocuments({ parentId: id, recursive });
        const { documents, categories } = filterDrafts(result);

        const nextActions = formatNextActions([
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
        ]);

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Category: ${id}\n\n` +
                reader.formatDocumentList({ documents, categories }) +
                nextActions,
            },
          ],
        };
      }

      // ID is not a category - suggest read instead
      return {
        content: [
          {
            type: "text" as const,
            text: `"${id}" is not a category. To read this document:\n\n\`instruction(action: "read", id: "${id}")\``,
          },
        ],
        isError: true,
      };
    }

    // Root listing. Drafts are nested under their own directory, so asking for
    // them has to descend whatever the caller said about the corpus.
    const result = await reader.listDocuments({ recursive: recursive || drafts === true });
    const { documents, categories } = filterDrafts(result);

    if (drafts === true) {
      return draftListing({ documents, reader });
    }

    const nextActions = formatNextActions([
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
    ]);

    return {
      content: [
        {
          type: "text" as const,
          text: reader.formatDocumentList({ documents, categories }) + nextActions,
        },
      ],
    };
  }
}
