import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import type { DocumentFrontmatter } from "../../../types/index.js";
import { updateFrontmatter, parseFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";
import { generateDiff, removeDiffFile, writeDiffToFile } from "../../../utils/diff-utils.js";
import { getPendingUpdate, savePendingUpdate } from "../../../utils/pending-update.js";
import { checkDocument, formatWriteLint, isReasonGiven } from "../../../services/document-lint.js";

// "At least one field to change" is checked in `doExecute`, not by a `.refine`
// on this schema. Not because a refinement cannot be used -- `buildInputSchema`
// unwraps one, and `safeParse` enforces it -- but because `execute` reports a
// validation failure as the issue JSON plus the help text, and what this check
// returns instead is the reason plus the two calls that would work.
//
// The trade is real in both directions: in the schema, the constraint is what
// `describe-matches-schemas` holds the documented examples to. See the design
// note for the shape that would get both.
const schema = z.object({
  action: z.literal("update"),
  id: z.string().describe("Document ID to update"),
  content: z
    .string()
    .optional()
    .describe(
      "New document content (markdown). Omit to change only the metadata below, keeping the body as it is."
    ),
  description: z.string().optional().describe("Updated description"),
  whenToUse: z.array(z.string()).optional().describe("Updated usage scenarios"),
  relatedDocs: z
    .array(z.string())
    .optional()
    .describe(
      "Replaces the document's relatedDocs. Pass the whole list, not an addition -- `link_add` / `link_remove` are the incremental pair."
    ),
  // Nullable, because three states have to be expressible and `optional` alone
  // gives two. `lint` asks for this field to be set *and* asks for it to be
  // removed once the document is back within the limit, so a write that could
  // only ever set it would leave the second instruction unactionable -- the
  // shape of the bug this field was added to fix.
  sizeExemption: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Why this document stays whole although it is over the line limit -- a reference table is worth more in one piece, and a runbook read out of order is not a runbook. `lint` reports the reason instead of the warning, so the next reader can tell a decision from an unaddressed finding. Pass null to remove it."
    ),
});

type Args = z.infer<typeof schema>;


/**
 * What `sizeExemption` was given, as one of three intents.
 *
 * `null` means remove, and a client that renders tool arguments as strings
 * cannot send it: what arrives is `"null"`, which 2.0.1 stored as the reason. So
 * the call `stale-size-exemption` recommends did nothing and the finding came
 * back unchanged. An empty string is accepted as remove for that reason -- it is
 * the one "no value" a stringifying client can express -- and the placeholders
 * are refused rather than stored, because a document whose reason reads "null"
 * is one the next reader cannot make sense of.
 */
function readSizeExemption(value: string | null | undefined):
  | { kind: "unchanged" }
  | { kind: "remove" }
  | { kind: "set"; reason: string }
  | { kind: "refused"; given: string } {
  if (value === undefined) return { kind: "unchanged" };
  if (value === null) return { kind: "remove" };

  const trimmed = value.trim();
  if (trimmed === "") return { kind: "remove" };
  if (!isReasonGiven(trimmed)) return { kind: "refused", given: trimmed };
  return { kind: "set", reason: value };
}

/** The refusal, naming both ways to remove it and what a reason is for. */
function refuseSizeExemption(params: { id: string; given: string }): ToolResponse {
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

export class UpdateHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "update";
  readonly help = `Update a draft or promoted document.

Usage:
- \`instruction(action: "update", id: "doc-id", content: "...")\` - Update the body
- \`instruction(action: "update", id: "doc-id", description: "...", whenToUse: ["..."], relatedDocs: ["..."])\`
  - Update the metadata alone; omitting \`content\` keeps the body as it is
- \`instruction(action: "update", id: "doc-id", sizeExemption: "<why it stays whole>")\`
  - Answer \`lint\`'s \`document-too-large\` with a reason instead of splitting; \`null\` removes it
- Draft: direct overwrite. Promoted: pending flow with diff preview.`;

  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, content, description, whenToUse, relatedDocs, sizeExemption } = params.args;
    const { reader } = params.context;

    const exemption = readSizeExemption(sizeExemption);
    if (exemption.kind === "refused") {
      return refuseSizeExemption({ id, given: exemption.given });
    }

    // Every field but the id is optional, so nothing in the schema stops
    // `update(id)` on its own -- which would rewrite the document with exactly
    // what it already said, and on a promoted document stage an empty diff for
    // someone to approve.
    if (
      content === undefined &&
      description === undefined &&
      whenToUse === undefined &&
      relatedDocs === undefined &&
      sizeExemption === undefined
    ) {
      return errorResponse(
        `Nothing to update for "${id}". Pass \`content\` to change the body, or \`description\` / \`whenToUse\` / \`relatedDocs\` / \`sizeExemption\` to change the metadata.` +
        formatNextActions([{
          action: "read_meta",
          description: "See what the metadata should say",
          example: `instruction(action: "read_meta", id: "${id}")`,
        }]));
    }

    // P1: draft/promoted同名存在ガード
    const draftId = DRAFT_PREFIX + id;
    const draftExists = await reader.documentExists(draftId);
    const promotedExists = await reader.documentExists(id);
    if (draftExists && promotedExists) {
      return errorResponse(`Both draft and promoted versions of "${id}" exist. Delete or promote the draft first, then retry.`);
    }

    // Check if draft exists first
    if (draftExists) {
      return this.handleDraftUpdate({ id, draftId, content, description, whenToUse, relatedDocs, sizeExemption, reader });
    }

    // Check if promoted document exists
    const originalContent = await reader.getDocumentContent(id);
    const originalPath = reader.getFilePath(id);

    if (!originalContent) {
      return errorResponse(`Error: Document "${id}" does not exist (neither as draft nor promoted).

Use \`instruction(action: "add", ...)\` to create a new document.`);
    }

    // Use pending flow for promoted document updates
    return this.handleExistingDocUpdate({
      id,
      content,
      description,
      whenToUse,
      relatedDocs,
      sizeExemption,
      originalContent,
      originalPath,
      reader,
    });
  }

  /**
   * Handle update for draft document (direct overwrite).
   */
  private async handleDraftUpdate(params: {
    id: string;
    draftId: string;
    content?: string;
    description?: string;
    whenToUse?: string[];
    relatedDocs?: string[];
    sizeExemption?: string | null;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { id, draftId, content, description, whenToUse, relatedDocs, sizeExemption, reader } = params;

    // Get existing draft to preserve frontmatter
    const existingContent = await reader.getDocumentContent(draftId);
    const existingFrontmatter = existingContent ? parseFrontmatter(existingContent) : {};

    const finalContent = this.generateContentWithFrontmatter({
      // No `content` means a metadata-only change, so the body carries over
      // untouched. Asking callers to resend a document they are not editing was
      // the reason metadata updates were avoided.
      content: content ?? existingContent ?? "",
      description,
      whenToUse,
      relatedDocs,
      sizeExemption,
      existingFrontmatter,
    });

    const updateResult = await reader.updateDocument({ id: draftId, content: finalContent });
    if (!updateResult.success) {
      return errorResponse(`Error: ${updateResult.error}`);
    }

    // Reported on every draft write, not only the first: a document goes over
    // the limit by being edited, and `add` alone would miss exactly the
    // documents that grew into the warning.
    const lint = formatWriteLint(checkDocument({ docId: id, content: finalContent }));

    return textResponse(
      `Draft "${id}" updated successfully.` +
        lint +
        formatNextActions([
          {
            action: "read",
            description: "Review updated content",
            example: `instruction(action: "read", id: "${id}")`,
          },
          {
            action: "approve",
            description: "Start approval",
            example: `instruction(action: "approve", id: "${id}", notes: "<self-review>")`,
          },
        ]),
    );
  }

  /**
   * Handle update for existing document (pending flow).
   * Creates diff and pending update, no draft file.
   */
  private async handleExistingDocUpdate(params: {
    id: string;
    content?: string;
    description?: string;
    whenToUse?: string[];
    relatedDocs?: string[];
    sizeExemption?: string | null;
    originalContent: string;
    originalPath: string;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { id, content, description, whenToUse, relatedDocs, sizeExemption, originalContent, originalPath, reader } = params;

    // Preserve existing frontmatter if not overridden
    const existingFrontmatter = parseFrontmatter(originalContent);

    const finalContent = this.generateContentWithFrontmatter({
      // A metadata-only change keeps the body. The diff below then shows only
      // the frontmatter lines that moved, which is the whole point of allowing
      // the call without it.
      content: content ?? originalContent,
      description,
      whenToUse,
      relatedDocs,
      sizeExemption,
      existingFrontmatter,
    });

    // Generate diff
    const diff = generateDiff({
      original: originalContent,
      updated: finalContent,
      options: {
        originalName: `original: ${id}`,
        newName: `updated: ${id}`,
      },
    });

    if (!diff) {
      return textResponse(`No changes detected for "${id}".`);
    }

    const docsDir = reader.getDirectory();

    // Re-staging replaces the previous entry, so its diff file has no owner
    // left to clean it up. They used to accumulate in tmp forever.
    const superseded = await getPendingUpdate({ docsDir, id });
    await removeDiffFile(superseded?.diffPath);

    const diffPath = await writeDiffToFile({ diff, id, docsDir });

    await savePendingUpdate({
      docsDir,
      id,
      content: finalContent,
      originalContent,
      originalPath,
      diffPath,
    });

    return textResponse(
      `Update prepared for "${id}".

\`\`\`diff
${diff}\`\`\`` +
        formatNextActions([
          {
            action: "apply",
            description: "Explain this change to the user, then apply it (twice -- the first call is refused on purpose)",
            example: `instruction(action: "apply", id: "${id}", explanation: "<what this changes and why>")`,
          },
          {
            action: "cancel",
            description: "Cancel this update",
            example: `instruction(action: "cancel", id: "${id}")`,
          },
        ]),
    );
  }

  /**
   * Generate content with frontmatter, preserving existing if not overridden.
   */
  private generateContentWithFrontmatter(params: {
    content: string;
    description?: string;
    whenToUse?: string[];
    relatedDocs?: string[];
    sizeExemption?: string | null;
    existingFrontmatter: DocumentFrontmatter;
  }): string {
    const { content, description, whenToUse, relatedDocs, sizeExemption, existingFrontmatter } = params;

    // Check if new content already has frontmatter
    const newFrontmatter = parseFrontmatter(content);
    const bodyContent = stripFrontmatter(content);

    // Merge order (later wins): existing < new content frontmatter < explicit params.
    // This preserves fields the caller did not touch (relatedDocs, status, etc.).
    const merged: DocumentFrontmatter = {
      ...existingFrontmatter,
      ...newFrontmatter,
    };

    if (description !== undefined) {
      merged.description = description;
    }
    if (whenToUse !== undefined) {
      merged.whenToUse = whenToUse;
    }
    if (relatedDocs !== undefined) {
      merged.relatedDocs = relatedDocs;
    }
    // `delete` rather than assigning null: `updateFrontmatter` removes a key
    // whose value is undefined, which is how the field goes away.
    const exemption = readSizeExemption(sizeExemption);
    if (exemption.kind === "remove") delete merged.sizeExemption;
    else if (exemption.kind === "set") merged.sizeExemption = exemption.reason;

    // Only infer description as a last-resort default when nothing is set.
    if (merged.description === undefined) {
      const inferred = this.inferDescription(bodyContent);
      if (inferred !== undefined) {
        merged.description = inferred;
      }
    }

    // If no metadata at all, return body without a frontmatter block.
    const hasAnyField = Object.values(merged).some((v) => {
      return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "";
    });
    if (!hasAnyField) {
      return content;
    }

    return updateFrontmatter({
      content: bodyContent,
      frontmatter: merged,
    });
  }

  /**
   * Infer description from first paragraph after title.
   */
  private inferDescription(content: string): string | undefined {
    const lines = content.split("\n");
    let foundTitle = false;
    const paragraphLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!foundTitle && trimmed === "") continue;
      if (!foundTitle && trimmed.startsWith("# ")) {
        foundTitle = true;
        continue;
      }
      if (foundTitle && trimmed === "" && paragraphLines.length === 0) continue;
      if (foundTitle && trimmed !== "") {
        if (trimmed.startsWith("#") || trimmed.startsWith("```")) break;
        paragraphLines.push(trimmed);
      }
      if (foundTitle && trimmed === "" && paragraphLines.length > 0) break;
    }

    return paragraphLines.length > 0 ? paragraphLines.join(" ") : undefined;
  }
}
