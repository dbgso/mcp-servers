import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { contentHash, DeliberationGate } from "mcp-shared/approval";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { removeDiffFile } from "../../../utils/diff-utils.js";
import { deletePendingUpdate, getPendingUpdate } from "../../../utils/pending-update.js";

const schema = z.object({
  action: z.literal("apply"),
  id: z.string(),
  explanation: z
    .string()
    .min(1)
    .describe(
      "What this update does and why, in your own words, as you described it to the user. Required, and it must be identical across both attempts."
    ),
});

/**
 * `apply` writes to a promoted document with no token, which is deliberate --
 * it is the ordinary way documents get maintained, and a notification round
 * trip on every edit would make that unworkable in a headless session. What it
 * does have is a deliberation gate: the first attempt is refused with
 * instructions to explain the change to the user, and only a second identical
 * attempt goes through.
 *
 * The refusal comes back as an ordinary response rather than an error, because
 * it is a step in the operation rather than a failure of it.
 *
 * This is disclosure, not consent. Nothing verifies the user was told. It makes
 * the change impossible to perform silently, which is the property worth having
 * for an operation whose worst outcome is a document with the wrong text in it.
 * The genuinely destructive operations -- delete, rename, promotion -- are
 * behind content-bound tokens instead.
 */
const deliberation = new DeliberationGate();

type Args = z.infer<typeof schema>;

export class ApplyHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "apply";
  readonly help = "Apply a pending update to a document.";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, explanation } = params.args;
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

    // Every check above has passed, so this is the point of no return -- and
    // the last point at which refusing costs nothing. The gate is keyed on the
    // change itself, so re-staging a different update starts a new run.
    const deliberated = deliberation.consider({
      operation: `instruction::apply::${id}`,
      what: `${pending.originalHash}\n${contentHash(pending.content)}`,
      explanation,
    });
    if (!deliberated.ok) {
      // Not `errorResponse`. Being refused here is a normal step of this
      // operation, and dressing it as a tool failure invites the caller to
      // treat the tool as broken and go looking for another way in.
      return textResponse(deliberated.message);
    }

    // Written through the reader, so the path comes from this server's
    // documents directory and the list cache is invalidated. Writing raw was
    // how a stale `list` outlived an applied update by up to a minute.
    const writeResult = await reader.updateDocument({ id, content: pending.content });
    if (!writeResult.success) {
      // The run is left standing on purpose: the user has already heard this
      // explanation once, and a failed write should not make them hear it again.
      return errorResponse(`Error applying update: ${writeResult.error}`);
    }

    deliberation.settle();

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
