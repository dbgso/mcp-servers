import type { ToolResponse } from "mcp-shared";
import { errorResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import type { MarkdownReader } from "../../../services/markdown-reader.js";

/** Which versions of one id exist. */
export type DocumentVersions = "ambiguous" | "draft" | "promoted" | "missing";

function promotedOrMissing(exists: boolean): DocumentVersions {
  return exists ? "promoted" : "missing";
}

/**
 * One value rather than the two booleans every write has to combine.
 *
 * `update` and `rename` were each asking "is there a draft" and "is there a
 * promoted document" and then reimplementing the same four-way answer, down to
 * an identical refusal message. Naming the state is what lets both of them read
 * as a dispatch instead of a chain of conjunctions.
 *
 * Both checks always run, even when the first settles the answer, because the
 * ambiguous case is only visible once both have.
 */
export async function resolveVersions(params: {
  reader: MarkdownReader;
  id: string;
}): Promise<DocumentVersions> {
  const { reader, id } = params;

  const draftExists = await reader.documentExists(DRAFT_PREFIX + id);
  const promotedExists = await reader.documentExists(id);

  if (!draftExists) return promotedOrMissing(promotedExists);
  if (promotedExists) return "ambiguous";
  return "draft";
}

/**
 * Both versions under one id is a state no write can act on: which one the
 * caller meant is unanswerable, and picking one silently writes to the document
 * they were not looking at.
 */
export function refuseAmbiguousId(id: string): ToolResponse {
  return errorResponse(
    `Both draft and promoted versions of "${id}" exist. Delete or promote the draft first, then retry.`,
  );
}
