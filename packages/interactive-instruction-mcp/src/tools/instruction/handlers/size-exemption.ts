import type { ToolResponse } from "mcp-shared";
import { formatNextActions, errorResponse } from "../types.js";
import { isReasonGiven } from "../../../services/document-lint.js";

/**
 * `sizeExemption` handling, shared by `add` and `update`.
 *
 * The two handlers carried byte-identical copies of this. They have to agree:
 * `add` and `update` declare the same field name, the tool merges every
 * handler's fields into one schema, and a caller who sets an exemption on
 * creation and removes it later is using one field through two doors.
 */

/** What `sizeExemption` was given, as one of four intents. */
export type SizeExemptionIntent =
  | { kind: "unchanged" }
  | { kind: "remove" }
  | { kind: "set"; reason: string }
  | { kind: "refused"; given: string };

/**
 * What a caller actually wrote, once `null` has been ruled out.
 *
 * An empty string means remove rather than "set it to nothing". A client that
 * renders tool arguments as strings cannot send `null`: what arrives is
 * `"null"`, which 2.0.1 stored as the reason, so the call
 * `stale-size-exemption` recommends did nothing and the finding came back
 * unchanged. An empty string is the one "no value" such a client can express,
 * and the placeholders are refused rather than stored, because a document whose
 * reason reads "null" is one the next reader cannot make sense of.
 */
function readGivenReason(value: string): SizeExemptionIntent {
  const trimmed = value.trim();
  if (trimmed === "") return { kind: "remove" };
  if (!isReasonGiven(trimmed)) return { kind: "refused", given: trimmed };
  return { kind: "set", reason: value };
}

export function readSizeExemption(value: string | null | undefined): SizeExemptionIntent {
  if (value === undefined) return { kind: "unchanged" };
  if (value === null) return { kind: "remove" };
  return readGivenReason(value);
}

/** The refusal, naming both ways to remove it and what a reason is for. */
export function refuseSizeExemption(params: { id: string; given: string }): ToolResponse {
  const { id, given } = params;
  return errorResponse(
    `\`sizeExemption: "${given}"\` is not a reason for keeping the document whole, and storing it would leave the next reader unable to tell a decision from a warning nobody got to.` +
    formatNextActions([
      {
        action: "update",
        description: "Remove the exemption",
        example: `instruction(action: "update", id: "${id}", sizeExemption: "")`,
      },
      {
        action: "update",
        description: "Say why the document stays whole",
        example: `instruction(action: "update", id: "${id}", sizeExemption: "<why>")`,
      },
    ]));
}

/**
 * The value a new document's frontmatter should carry.
 *
 * "Explicitly none" and "nothing said" differ only here: the first clears the
 * field, the second falls back to whatever the frontmatter inside `content`
 * claimed.
 */
export function newSizeExemption(params: {
  intent: SizeExemptionIntent;
  existing: string | undefined;
}): string | undefined {
  const { intent, existing } = params;
  if (intent.kind === "set") return intent.reason;
  if (intent.kind === "remove") return undefined;
  return existing;
}
