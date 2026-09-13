import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { contentHash } from "mcp-shared/approval";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { removeDiffFile } from "../../../utils/diff-utils.js";
import { deletePendingUpdate, getPendingUpdate } from "../../../utils/pending-update.js";

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
    const { reader } = params.context;
    const docsDir = reader.getDirectory();

    const pending = await getPendingUpdate({ docsDir, id });
    if (!pending) {
      return errorResponse(`No pending update found for "${id}".` +
        formatNextActions([{
          action: "update",
          description: "Prepare an update first",
          example: `instruction(action: "update", id: "${id}", content: "...")`,
        }]));
    }

    // The document has to still be the one the diff was computed against.
    //
    // This used to write `pending.content` to `pending.originalPath` with no
    // check at all -- no re-read, no existence test, no comparison. Three
    // things followed. An edit made between `update` and `apply` was silently
    // discarded, so the diff the human read was not the diff that got applied.
    // A document deleted under an approval token came back, because
    // `writeFile` recreates. And because the path came out of the stored record
    // rather than from this reader, another server's file could be written
    // instead of this one's.
    const current = await reader.getDocumentContent(id);
    if (current === null) {
      await deletePendingUpdate({ docsDir, id });
      await removeDiffFile(pending.diffPath);
      return errorResponse(
        `Document "${id}" no longer exists, so this update was discarded rather than recreating it.` +
        formatNextActions([{
          action: "add",
          description: "Create it again as a draft",
          example: `instruction(action: "add", id: "${id}", content: "...", description: "...", whenToUse: [...])`,
        }]));
    }

    if (contentHash(current) !== pending.originalHash) {
      return errorResponse(
        `Document "${id}" changed after this update was prepared, so the diff you reviewed is not the diff that would be applied.` +
        formatNextActions([
          {
            action: "cancel",
            description: "Discard the stale update",
            example: `instruction(action: "cancel", id: "${id}")`,
          },
          {
            action: "read",
            description: "Read the document as it stands now",
            example: `instruction(action: "read", id: "${id}")`,
          },
        ]));
    }

    // Written through the reader, so the path comes from this server's
    // documents directory and the list cache is invalidated. Writing raw was
    // how a stale `list` outlived an applied update by up to a minute.
    const writeResult = await reader.updateDocument({ id, content: pending.content });
    if (!writeResult.success) {
      return errorResponse(`Error applying update: ${writeResult.error}`);
    }

    await deletePendingUpdate({ docsDir, id });
    await removeDiffFile(pending.diffPath);

    return textResponse(
      `Update applied successfully to "${id}".

Path: ${reader.getFilePath(id)}` +
      formatNextActions([
        { action: "read", description: "Read the updated document", example: `instruction(action: "read", id: "${id}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }
}
