import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { getPendingUpdate, deletePendingUpdate } from "../../../utils/pending-update.js";
import * as fs from "node:fs/promises";

const schema = z.object({
  action: z.literal("apply"),
  id: z.string(),
});

type Args = z.infer<typeof schema>;


export class ApplyHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "apply";
  readonly help = "Apply a pending update to a document.";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id } = params.args;

    // Get pending update
    const pending = await getPendingUpdate(id);
    if (!pending) {
      return errorResponse(`No pending update found for "${id}".` +
        formatNextActions([{
          action: "update",
          description: "Prepare an update first",
          example: `instruction(action: "update", id: "${id}", content: "...")`,
        }]));
    }

    // Apply the update
    try {
      await fs.writeFile(pending.originalPath, pending.content, "utf-8");
    } catch (error) {
      return errorResponse(`Error applying update: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Clean up pending update and diff file
    await deletePendingUpdate(id);
    try {
      await fs.unlink(pending.diffPath);
    } catch {
      // Ignore if diff file already deleted
    }

    return textResponse(
      `Update applied successfully to "${id}".

Path: ${pending.originalPath}` +
      formatNextActions([
        { action: "read", description: "Read the updated document", example: `instruction(action: "read", id: "${id}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }
}
