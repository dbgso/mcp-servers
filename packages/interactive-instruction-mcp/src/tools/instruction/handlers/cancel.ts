import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { removeDiffFile } from "../../../utils/diff-utils.js";
import { deletePendingUpdate, getPendingUpdate } from "../../../utils/pending-update.js";

const schema = z.object({
  action: z.literal("cancel"),
  id: z.string(),
});

type Args = z.infer<typeof schema>;


export class CancelHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "cancel";
  readonly help = "Cancel a pending update for a document.";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id } = params.args;
    const docsDir = params.context.reader.getDirectory();

    // Get pending update
    const pending = await getPendingUpdate({ docsDir, id });
    if (!pending) {
      return errorResponse(`No pending update found for "${id}".` +
        formatNextActions([{
          action: "list",
          description: "View all documents",
          example: `instruction(action: "list")`,
        }]));
    }

    // Clean up pending update and diff file
    await deletePendingUpdate({ docsDir, id });
    await removeDiffFile(pending.diffPath);

    return textResponse(
      `Pending update for "${id}" cancelled.` +
      formatNextActions([
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }
}
