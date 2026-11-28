import type { ToolResponse } from "mcp-shared";
import { errorResponse, formatNextActions } from "../types.js";
import { frontmatterErrors } from "../../../utils/frontmatter-parser.js";

/**
 * A write onto frontmatter that cannot be parsed, refused rather than done.
 *
 * `updateFrontmatter` starts from an empty block when the existing one is
 * unreadable, on the reasoning that rewriting a guess over the file is worse than
 * losing what could not be read. That is right about not guessing and wrong about
 * the silence: a caller who asked to change a description got `whenToUse` and
 * `relatedDocs` deleted without being told, and on a draft there is not even a diff
 * to notice it in.
 *
 * So the write stops and says what is wrong with the file. The repair is a pair of
 * quotes, and after it every other field survives the write as usual.
 */
export function refuseUnreadableFrontmatter(params: { id: string; content: string }): ToolResponse | null {
  const { id, content } = params;
  const errors = frontmatterErrors(content);
  if (errors.length === 0) return null;

  return errorResponse(
    `"${id}" has frontmatter that is not valid YAML, and writing to it would drop ` +
    `every field that cannot be read -- silently, because what cannot be parsed ` +
    `cannot be shown in a diff either: ${errors[0]}. ` +
    "A value containing `: ` has to be quoted, which is the usual cause. Repair the " +
    "file, then this action keeps the rest of the block as it is." +
    formatNextActions([
      {
        action: "lint",
        description: "See it alongside anything else in the corpus",
        example: `instruction(action: "lint")`,
      },
      {
        action: "read",
        description: "Read the document as it stands",
        example: `instruction(action: "read", id: "${id}")`,
      },
    ]));
}
