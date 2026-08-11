import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions } from "../types.js";
import { DRAFT_DIR } from "../../../constants.js";
import type { MarkdownSummary } from "../../../types/index.js";

const listSchema = z.object({
  action: z.literal("list"),
  id: z.string().optional().describe("Parent ID to list documents under"),
  recursive: z.boolean().optional().default(false).describe("Include nested documents"),
  query: z.string().optional().describe("Search by description or whenToUse"),
  missingMeta: z.enum(["description", "whenToUse", "any"]).optional()
    .describe("Find documents with missing metadata"),
  backlinks: z.boolean().optional().describe("Find documents referencing this ID"),
});

type ListArgs = z.infer<typeof listSchema>;

export class ListHandler extends BaseActionHandler<ListArgs, InstructionContext> {
  readonly action = "list";
  readonly help = `List documents.

Usage:
- \`instruction(action: "list")\` - List root documents
- \`instruction(action: "list", recursive: true)\` - List all documents
- \`instruction(action: "list", id: "category")\` - List documents in category
- \`instruction(action: "list", query: "search term")\` - Search documents
- \`instruction(action: "list", missingMeta: "any")\` - Find docs with missing metadata
- \`instruction(action: "list", id: "doc-id", backlinks: true)\` - Find documents referencing this doc`;

  readonly schema = listSchema;

  protected async doExecute(params: {
    args: ListArgs;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { args, context } = params;
    const { reader } = context;
    const { id, recursive, query, missingMeta, backlinks } = args;

    // Helper to filter out drafts from public listing
    const filterDrafts = (result: {
      documents: MarkdownSummary[];
      categories: { id: string; docCount: number }[];
    }) => ({
      documents: result.documents.filter((d) => !d.id.startsWith(DRAFT_DIR)),
      categories: result.categories.filter((c) => c.id !== DRAFT_DIR),
    });

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
      const noDescription = !doc.description || doc.description.trim() === "";
      const noWhenToUse = !doc.whenToUse || doc.whenToUse.length === 0;

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

    // Root listing
    const result = await reader.listDocuments({ recursive });
    const { documents, categories } = filterDrafts(result);

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
