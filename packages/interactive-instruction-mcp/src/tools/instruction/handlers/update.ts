import { z } from "zod";
import { BaseActionHandler, looseArray, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import type { DocumentFrontmatter } from "../../../types/index.js";
import { updateFrontmatter, parseFrontmatter, stripFrontmatter, assignIfDefined } from "../../../utils/frontmatter-parser.js";
import { refuseUnreadableFrontmatter } from "./frontmatter-guard.js";
import { generateDiff, removeDiffFile, writeDiffToFile } from "../../../utils/diff-utils.js";
import { getPendingUpdate, savePendingUpdate } from "../../../utils/pending-update.js";
import { checkDocument, formatWriteLint } from "../../../services/document-lint.js";
import {
  readSizeExemption,
  refuseSizeExemption,
  type SizeExemptionIntent,
} from "./size-exemption.js";
import { resolveVersions, refuseAmbiguousId } from "./document-versions.js";

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
  whenToUse: looseArray(z.array(z.string()).optional().describe("Updated usage scenarios")),
  relatedDocs: looseArray(
    z
      .array(z.string())
      .optional()
      .describe(
        "Replaces the document's relatedDocs. Pass the whole list, not an addition -- `link_add` / `link_remove` are the incremental pair."
      ),
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

/** One update, threaded through the routing below without re-listing its fields. */
type UpdateRun = { args: Args; reader: InstructionContext["reader"] };


/**
 * The fields a call can actually change.
 *
 * Every one is optional in the schema, so nothing there stops `update(id)` on
 * its own -- which would rewrite the document with exactly what it already
 * said, and on a promoted document stage an empty diff for someone to approve.
 * A list rather than a conjunction, so a field added to the schema is a line
 * here rather than a condition nobody remembers to extend.
 */
const CHANGEABLE_FIELDS = ["content", "description", "whenToUse", "relatedDocs", "sizeExemption"] as const;

function nothingToUpdate(args: Args): boolean {
  return CHANGEABLE_FIELDS.every((field) => args[field] === undefined);
}

function refuseEmptyUpdate(id: string): ToolResponse {
  return errorResponse(
    `Nothing to update for "${id}". Pass \`content\` to change the body, or \`description\` / \`whenToUse\` / \`relatedDocs\` / \`sizeExemption\` to change the metadata.` +
    formatNextActions([{
      action: "read_meta",
      description: "See what the metadata should say",
      example: `instruction(action: "read_meta", id: "${id}")`,
    }]));
}

function refuseMissingDocument(id: string): ToolResponse {
  return errorResponse(`Error: Document "${id}" does not exist (neither as draft nor promoted).

Use \`instruction(action: "add", ...)\` to create a new document.`);
}

/**
 * The two ways a call is refused before anything is read: a `sizeExemption`
 * that is not a reason, and a call that would change nothing.
 */
function refuseUnusableArgs(args: Args): ToolResponse | null {
  const exemption = readSizeExemption(args.sizeExemption);
  if (exemption.kind === "refused") {
    return refuseSizeExemption({ id: args.id, given: exemption.given });
  }
  if (nothingToUpdate(args)) return refuseEmptyUpdate(args.id);
  return null;
}

/**
 * No `content` means a metadata-only change, so the body carries over
 * untouched. Asking callers to resend a document they are not editing was the
 * reason metadata updates were avoided.
 */
function bodyToWrite(params: { content: string | undefined; existing: string | null }): string {
  return params.content ?? params.existing ?? "";
}

/**
 * Record a field only when the caller passed one.
 *
 * `undefined` means "not passed", which has to leave the existing value alone:
 * assigning it would clear the fields a metadata-only update left out. Same
 * shape, and for the same reason, as `parseFrontmatter`'s own `assignIfDefined`.
 */
function applyExemption(params: { merged: DocumentFrontmatter; exemption: SizeExemptionIntent }): void {
  const { merged, exemption } = params;
  // `delete` rather than assigning null: `updateFrontmatter` removes a key
  // whose value is undefined, which is how the field goes away.
  if (exemption.kind === "remove") delete merged.sizeExemption;
  if (exemption.kind === "set") merged.sizeExemption = exemption.reason;
}

/** No metadata at all means the body is returned without a frontmatter block. */
function hasAnyField(frontmatter: DocumentFrontmatter): boolean {
  return Object.values(frontmatter).some((v) => {
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "";
  });
}

/** A blank line, a heading or a fence closes the run of prose under the title. */
function endsRun(trimmed: string): boolean {
  return trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("```");
}

/**
 * The lines below the `# ` title, or nothing when the document has no title.
 *
 * A document with no title has no description to infer: whatever prose comes
 * first is as likely to be a note to the reader as a summary.
 */
function linesAfterTitle(lines: string[]): string[] {
  const titleIndex = lines.findIndex((line) => line.trim().startsWith("# "));
  if (titleIndex === -1) return [];
  return lines.slice(titleIndex + 1);
}

/** The first run of non-blank lines, trimmed. */
function firstParagraph(lines: string[]): string[] {
  const trimmed = lines.map((line) => line.trim());
  const start = trimmed.findIndex((line) => line !== "");
  if (start === -1) return [];

  const rest = trimmed.slice(start);
  const end = rest.findIndex(endsRun);
  return end === -1 ? rest : rest.slice(0, end);
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
    const refusal = refuseUnusableArgs(params.args);
    if (refusal !== null) return refusal;

    return this.updateResolved({ args: params.args, reader: params.context.reader });
  }

  /** Which document the id refers to, once the arguments are known to be usable. */
  private async updateResolved(run: UpdateRun): Promise<ToolResponse> {
    const { args, reader } = run;

    const versions = await resolveVersions({ reader, id: args.id });
    if (versions === "ambiguous") return refuseAmbiguousId(args.id);
    if (versions === "draft") return this.handleDraftUpdate(run);
    // `missing` joins the promoted path rather than refusing here: the refusal is
    // the same either way, and reading the content is what tells a document that
    // is absent from one that is empty.
    return this.updatePromoted(run);
  }

  private async updatePromoted(run: UpdateRun): Promise<ToolResponse> {
    const { args, reader } = run;

    const originalContent = await reader.getDocumentContent(args.id);
    const originalPath = reader.getFilePath(args.id);
    if (!originalContent) return refuseMissingDocument(args.id);

    const unreadable = refuseUnreadableFrontmatter({ id: args.id, content: originalContent });
    if (unreadable !== null) return unreadable;

    return this.handleExistingDocUpdate({ args, originalContent, originalPath, reader });
  }

  /**
   * Handle update for draft document (direct overwrite).
   */
  private async handleDraftUpdate(run: UpdateRun): Promise<ToolResponse> {
    const { args, reader } = run;
    const { id } = args;
    const draftId = DRAFT_PREFIX + id;

    // Get existing draft to preserve frontmatter
    const existingContent = await reader.getDocumentContent(draftId);
    if (existingContent !== null) {
      const unreadable = refuseUnreadableFrontmatter({ id, content: existingContent });
      if (unreadable !== null) return unreadable;
    }
    const existingFrontmatter = existingContent ? parseFrontmatter(existingContent) : {};

    const finalContent = this.generateContentWithFrontmatter({
      args,
      content: bodyToWrite({ content: args.content, existing: existingContent }),
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
    args: Args;
    originalContent: string;
    originalPath: string;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { args, originalContent, originalPath, reader } = params;
    const { id } = args;

    // Preserve existing frontmatter if not overridden
    const existingFrontmatter = parseFrontmatter(originalContent);

    const finalContent = this.generateContentWithFrontmatter({
      args,
      // A metadata-only change keeps the body. The diff below then shows only
      // the frontmatter lines that moved, which is the whole point of allowing
      // the call without it.
      content: bodyToWrite({ content: args.content, existing: originalContent }),
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
    args: Args;
    content: string;
    existingFrontmatter: DocumentFrontmatter;
  }): string {
    const { args, content, existingFrontmatter } = params;
    const { description, whenToUse, relatedDocs, sizeExemption } = args;

    const bodyContent = stripFrontmatter(content);

    // Merge order (later wins): existing < new content frontmatter < explicit params.
    // This preserves fields the caller did not touch (relatedDocs, status, etc.).
    const merged: DocumentFrontmatter = {
      ...existingFrontmatter,
      ...parseFrontmatter(content),
    };

    assignIfDefined({ target: merged, key: "description", value: description });
    assignIfDefined({ target: merged, key: "whenToUse", value: whenToUse });
    assignIfDefined({ target: merged, key: "relatedDocs", value: relatedDocs });
    applyExemption({ merged, exemption: readSizeExemption(sizeExemption) });
    this.applyInferredDescription({ merged, body: bodyContent });

    if (!hasAnyField(merged)) {
      return content;
    }

    return updateFrontmatter({
      content: bodyContent,
      frontmatter: merged,
    });
  }

  /**
   * A last-resort default: an explicit description always wins, and a body whose
   * first paragraph is unusable keeps no description rather than a bad one.
   */
  private applyInferredDescription(params: { merged: DocumentFrontmatter; body: string }): void {
    const { merged, body } = params;
    if (merged.description !== undefined) return;

    const inferred = this.inferDescription(body);
    if (inferred === undefined) return;
    merged.description = inferred;
  }

  /**
   * Infer description from first paragraph after title.
   *
   * Split into "where the body starts" and "where the paragraph ends" because
   * the single pass this replaced carried a `foundTitle` flag through five
   * conditions, and which of them applied to which line was the part nobody
   * could check.
   */
  private inferDescription(content: string): string | undefined {
    const paragraph = firstParagraph(linesAfterTitle(content.split("\n")));
    if (paragraph.length === 0) return undefined;
    return paragraph.join(" ");
  }
}
