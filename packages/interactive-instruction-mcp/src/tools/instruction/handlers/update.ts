import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, errorResponse, textResponse } from "../types.js";
import { DRAFT_PREFIX } from "../../../constants.js";
import type { DocumentFrontmatter } from "../../../types/index.js";
import { updateFrontmatter, parseFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";
import { generateDiff, removeDiffFile, writeDiffToFile } from "../../../utils/diff-utils.js";
import { getPendingUpdate, savePendingUpdate } from "../../../utils/pending-update.js";

// Deliberately a plain object, with no `.refine`: the tool's inputSchema is
// assembled by merging every handler's `.shape`, and a refinement wraps the
// object in a type that has none -- which takes out the schema for every other
// action too. "At least one field" is checked in `doExecute` instead.
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
});

type Args = z.infer<typeof schema>;


export class UpdateHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "update";
  readonly help = `Update a draft or promoted document.

Usage:
- \`instruction(action: "update", id: "doc-id", content: "...")\` - Update the body
- \`instruction(action: "update", id: "doc-id", description: "...", whenToUse: ["..."])\` - Update
  the metadata alone; omitting \`content\` keeps the body as it is
- Draft: direct overwrite. Promoted: pending flow with diff preview.`;

  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, content, description, whenToUse } = params.args;
    const { reader } = params.context;

    // Every field but the id is optional, so nothing in the schema stops
    // `update(id)` on its own -- which would rewrite the document with exactly
    // what it already said, and on a promoted document stage an empty diff for
    // someone to approve.
    if (content === undefined && description === undefined && whenToUse === undefined) {
      return errorResponse(
        `Nothing to update for "${id}". Pass \`content\` to change the body, or \`description\` / \`whenToUse\` to change the metadata.` +
        formatNextActions([{
          action: "update_meta",
          description: "See what the metadata should say",
          example: `instruction(action: "update_meta", id: "${id}")`,
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
      return this.handleDraftUpdate({ id, draftId, content, description, whenToUse, reader });
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
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { id, draftId, content, description, whenToUse, reader } = params;

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
      existingFrontmatter,
    });

    const updateResult = await reader.updateDocument({ id: draftId, content: finalContent });
    if (!updateResult.success) {
      return errorResponse(`Error: ${updateResult.error}`);
    }

    return textResponse(
      `Draft "${id}" updated successfully.` +
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
    originalContent: string;
    originalPath: string;
    reader: InstructionContext["reader"];
  }): Promise<ToolResponse> {
    const { id, content, description, whenToUse, originalContent, originalPath, reader } = params;

    // Preserve existing frontmatter if not overridden
    const existingFrontmatter = parseFrontmatter(originalContent);

    const finalContent = this.generateContentWithFrontmatter({
      // A metadata-only change keeps the body. The diff below then shows only
      // the frontmatter lines that moved, which is the whole point of allowing
      // the call without it.
      content: content ?? originalContent,
      description,
      whenToUse,
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
    existingFrontmatter: DocumentFrontmatter;
  }): string {
    const { content, description, whenToUse, existingFrontmatter } = params;

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
