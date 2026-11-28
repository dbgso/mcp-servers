import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions, textResponse } from "../types.js";
import { isInternalDocument } from "../../../constants.js";

/**
 * `id` is required, and that is the whole point of this being its own action.
 *
 * This was `list(backlinks: true)`, where `id` had to be optional because every
 * other mode of `list` either takes no id or takes one meaning something else --
 * the category to list inside. So the one argument this question cannot work
 * without was optional, the dependency lived in an `if (backlinks && id)`, and a
 * call that omitted the id fell through every mode to the root listing and
 * answered "which documents reference this?" with the whole corpus.
 *
 * Here the schema carries it. There is no condition to state, no guard to write
 * and nothing for the two to drift apart about.
 */
const schema = z.object({
  action: z.literal("backlinks"),
  id: z.string().describe("The document whose incoming relations to find"),
});

type Args = z.infer<typeof schema>;

/**
 * Which documents point at one document.
 *
 * Split out of `list` because nothing in `list` composed with it: `id` meant the
 * subject of a relation rather than a scope to list within, `recursive` was
 * ignored because backlinks always span the corpus, and `query`, `missingMeta`
 * and `drafts` were refused. A mode that shares no parameter with the others is
 * not a mode.
 *
 * `graph` answers the same question as part of a larger one, and still does --
 * `graph(id, depth: 2)` is how to see two hops. This is the one hop, with the
 * descriptions, for the question actually being asked: before deleting or
 * renaming a document, who depends on it. `delete` and `rename` already ask it
 * on the caller's behalf through the same reader method.
 */
export class BacklinksHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "backlinks";
  readonly help = `Find the documents that reference one document in their relatedDocs.

Usage:
- \`instruction(action: "backlinks", id: "doc-id")\`

For the wider picture, \`graph(id: "doc-id", depth: 2, format: "text")\` walks
further out and names both directions.`;

  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id } = params.args;
    const { reader } = params.context;

    // "Nothing references it" and "there is no such document" are different
    // facts, and the second one used to be reported as the first -- which sends
    // the caller off to add links to an id that was mistyped.
    if (!(await reader.documentExists(id))) {
      return errorResponse(
        `No document "${id}", so nothing can reference it.` +
        formatNextActions([
          {
            action: "list",
            description: "Find the id",
            example: 'instruction(action: "list", recursive: true)',
          },
        ]));
    }

    // Drafts are left out for the same reason `lint` leaves them out of the
    // corpus-wide rules: a draft is usually a near-copy of the document it will
    // replace, so its links are the old document's links counted twice.
    const referencing = (await reader.findBacklinks(id)).filter(
      (doc) => !isInternalDocument(doc.id)
    );

    if (referencing.length === 0) {
      return textResponse(
        `No documents reference "${id}" in their relatedDocs.` +
        formatNextActions([
          {
            action: "link_add",
            description: "Relate another document to this one",
            example: `instruction(action: "link_add", id: "<other-id>", relatedDocs: ["${id}"], explanation: "<what the link means>")`,
          },
          {
            action: "lint",
            description: "See which other documents nothing links to",
            example: 'instruction(action: "lint")',
          },
        ]));
    }

    return textResponse(
      `Documents referencing "${id}": ${referencing.length} found\n\n` +
      reader.formatDocumentList({ documents: referencing, categories: [] }));
  }
}
