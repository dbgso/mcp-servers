import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import { stripFrontmatter } from "../../../utils/frontmatter-parser.js";

const readSchema = z.object({
  action: z.literal("read"),
  id: z.string().describe("Document ID to read"),
});

type ReadArgs = z.infer<typeof readSchema>;

export class ReadHandler extends BaseActionHandler<ReadArgs, InstructionContext> {
  readonly action = "read";
  readonly help = `Read a document's prose. Metadata is not included.

Usage:
- \`instruction(action: "read", id: "doc-id")\` - Read a promoted document
- \`instruction(action: "read", id: "draft-id")\` - Read a draft (checks _mcp_drafts first)
- \`instruction(action: "update_meta", id: "doc-id")\` - Read the metadata instead

The frontmatter is left out on purpose: \`description\`, \`whenToUse\` and
\`relatedDocs\` are how the corpus is navigated, not part of what a document
says, and a draft's \`status\` and \`selfReviewNotes\` are the approval
conversation. None of it belongs in the answer to "what does this document
say". \`update_meta\` is where metadata is read.`;

  readonly schema = readSchema;

  protected async doExecute(params: {
    args: ReadArgs;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { args, context } = params;
    const { reader } = context;
    const { id } = args;

    // Check if this is a draft ID (without prefix)
    const draftId = DRAFT_PREFIX + id;
    const draftContent = await reader.getDocumentContent(draftId);

    if (draftContent !== null) {
      // It's a draft
      const nextActions = formatNextActions([
        {
          action: "update",
          description: "Update this draft",
          example: `instruction(action: "update", id: "${id}", content: "...")`,
        },
        {
          action: "approve",
          description: "Start approval workflow",
          example: `instruction(action: "approve", id: "${id}", notes: "<self-review>")`,
        },
        {
          action: "delete",
          description: "Delete this draft",
          example: `instruction(action: "delete", id: "${id}")`,
        },
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: `**[Draft]** ${id}\n\n${stripFrontmatter(draftContent)}${nextActions}`,
          },
        ],
      };
    }

    // Try to get promoted document
    const content = await reader.getDocumentContent(id);

    if (content === null) {
      // Document not found - suggest create
      return {
        content: [
          {
            type: "text" as const,
            text: `Document "${id}" not found.

To create a new draft with this ID:
\`instruction(action: "add", id: "${id}", content: "...", description: "...", whenToUse: [...])\`

To list available documents:
\`instruction(action: "list")\``,
          },
        ],
        isError: true,
      };
    }

    // It's a promoted document
    const nextActions = formatNextActions([
      {
        action: "update",
        description: "Prepare an update for this document",
        example: `instruction(action: "update", id: "${id}", content: "...")`,
      },
      {
        action: "link_add",
        description: "Add related documents",
        example: `instruction(action: "link_add", id: "${id}", relatedDocs: ["other-doc"])`,
      },
      {
        action: "update_meta",
        description: "See this document's metadata, and what it sits next to",
        example: `instruction(action: "update_meta", id: "${id}")`,
      },
      {
        action: "list",
        description: "List all documents",
        example: 'instruction(action: "list")',
      },
    ]);

    return {
      content: [{ type: "text" as const, text: stripFrontmatter(content) + nextActions }],
    };
  }
}
