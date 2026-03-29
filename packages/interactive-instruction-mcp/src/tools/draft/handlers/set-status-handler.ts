import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext, DraftStatus } from "../../../types/index.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import { parseFrontmatter, updateFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";

const VALID_STATUSES: DraftStatus[] = ["editing", "self_review", "user_reviewing", "pending_approval"];

export class SetStatusHandler implements DraftActionHandler {
  async execute(params: {
    actionParams: DraftActionParams;
    context: DraftActionContext;
  }): Promise<ToolResult> {
    const { id, ids, status } = params.actionParams;
    const { reader } = params.context;

    if (!status) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: status is required for set_status action.

Valid statuses: ${VALID_STATUSES.join(", ")}

Examples:
- Single: \`draft(action: "set_status", id: "doc-id", status: "editing")\`
- Batch:  \`draft(action: "set_status", ids: "id1,id2,id3", status: "editing")\``,
          },
        ],
        isError: true,
      };
    }

    // Validate status value
    if (!VALID_STATUSES.includes(status as DraftStatus)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Invalid status "${status}".

Valid statuses: ${VALID_STATUSES.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    // Determine target IDs
    let targetIds: string[] = [];
    if (ids) {
      targetIds = ids.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    } else if (id) {
      targetIds = [id];
    } else {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: id or ids is required for set_status action.",
          },
        ],
        isError: true,
      };
    }

    const results: string[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const targetId of targetIds) {
      const draftId = DRAFT_PREFIX + targetId;
      const content = await reader.getDocumentContent(draftId);

      if (content === null) {
        results.push(`- ${targetId}: not found`);
        errorCount++;
        continue;
      }

      // Parse existing frontmatter
      const existingFrontmatter = parseFrontmatter(content);
      const oldStatus = existingFrontmatter.status || "(none)";

      // Update frontmatter with new status
      const newFrontmatter = {
        ...existingFrontmatter,
        status: status as DraftStatus,
      };

      const body = stripFrontmatter(content);
      const newContent = updateFrontmatter({
        content: body,
        frontmatter: newFrontmatter,
      });

      // Write updated content
      const updateResult = await reader.updateDocument({
        id: draftId,
        content: newContent,
      });

      if (updateResult.success) {
        results.push(`- ${targetId}: ${oldStatus} → ${status}`);
        successCount++;
      } else {
        results.push(`- ${targetId}: failed - ${updateResult.error}`);
        errorCount++;
      }
    }

    const summary = targetIds.length === 1
      ? `Status updated for "${targetIds[0]}".`
      : `Batch status update: ${successCount} succeeded, ${errorCount} failed.`;

    return {
      content: [
        {
          type: "text" as const,
          text: `# Set Status Result

${summary}

## Details
${results.join("\n")}`,
        },
      ],
    };
  }
}
