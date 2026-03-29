import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext } from "../../../types/index.js";
import { getPendingUpdate, deletePendingUpdate } from "../../../utils/pending-update.js";
import * as fs from "node:fs/promises";

export class ApplyHandler implements DraftActionHandler {
  async execute(params: {
    actionParams: DraftActionParams;
    context: DraftActionContext;
  }): Promise<ToolResult> {
    const { id } = params.actionParams;

    if (!id) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: id is required for apply action",
          },
        ],
        isError: true,
      };
    }

    // Get pending update
    const pending = await getPendingUpdate(id);
    if (!pending) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No pending update found for "${id}".

Use \`draft(action: "update", id: "${id}", content: "...")\` to prepare an update first.`,
          },
        ],
        isError: true,
      };
    }

    // Apply the update
    try {
      await fs.writeFile(pending.originalPath, pending.content, "utf-8");
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error applying update: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }

    // Clean up pending update and diff file
    await deletePendingUpdate(id);
    try {
      await fs.unlink(pending.diffPath);
    } catch {
      // Ignore if diff file already deleted
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Update applied successfully to "${id}".

Path: ${pending.originalPath}`,
        },
      ],
    };
  }
}
