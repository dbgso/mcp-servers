import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext } from "../../../types/index.js";
import { updateFrontmatter, parseFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";
import { generateDiff, writeDiffToFile } from "../../../utils/diff-utils.js";
import { savePendingUpdate } from "../../../utils/pending-update.js";

export class UpdateHandler implements DraftActionHandler {
  async execute(params: {
    actionParams: DraftActionParams;
    context: DraftActionContext;
  }): Promise<ToolResult> {
    const { id, content, description, whenToUse } = params.actionParams;
    const { reader } = params.context;

    if (!id || !content) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: id and content are required for update action",
          },
        ],
        isError: true,
      };
    }

    // Check if original document exists (not draft)
    const originalContent = await reader.getDocumentContent(id);
    const originalPath = reader.getFilePath(id);

    // If original doesn't exist, return error
    if (!originalContent) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Document "${id}" does not exist.

Use \`draft(action: "add", ...)\` to create a new document.`,
          },
        ],
        isError: true,
      };
    }

    // Use pending flow for existing document updates
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
   * Handle update for existing document (new flow).
   * Creates diff and pending update, no draft file.
   */
  private async handleExistingDocUpdate(params: {
    id: string;
    content: string;
    description?: string;
    whenToUse?: string[];
    originalContent: string;
    originalPath: string;
    reader: DraftActionContext["reader"];
  }): Promise<ToolResult> {
    const { id, content, description, whenToUse, originalContent, originalPath } = params;

    // Preserve existing frontmatter if not overridden
    const existingFrontmatter = parseFrontmatter(originalContent);

    const finalContent = this.generateContentWithFrontmatter({
      content,
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
      return {
        content: [
          {
            type: "text" as const,
            text: `No changes detected for "${id}".`,
          },
        ],
      };
    }

    // Write diff to file
    const diffPath = await writeDiffToFile({ diff, id });

    // Save pending update
    await savePendingUpdate({
      id,
      content: finalContent,
      originalPath,
      diffPath,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Update prepared for "${id}".

\`\`\`diff
${diff}\`\`\`

---

To apply this update:
\`draft(action: "apply", id: "${id}")\`

To cancel:
\`draft(action: "cancel", id: "${id}")\``,
        },
      ],
    };
  }

  /**
   * Generate content with frontmatter, preserving existing if not overridden.
   */
  private generateContentWithFrontmatter(params: {
    content: string;
    description?: string;
    whenToUse?: string[];
    existingFrontmatter: { description?: string; whenToUse?: string[] };
  }): string {
    const { content, description, whenToUse, existingFrontmatter } = params;

    // Check if new content already has frontmatter
    const newFrontmatter = parseFrontmatter(content);
    const bodyContent = stripFrontmatter(content);

    // Priority: explicit params > new content frontmatter > existing frontmatter > infer
    const finalDescription = description
      ?? newFrontmatter.description
      ?? existingFrontmatter.description
      ?? this.inferDescription(bodyContent);

    const finalWhenToUse = whenToUse
      ?? newFrontmatter.whenToUse
      ?? existingFrontmatter.whenToUse
      ?? undefined;

    // If no metadata, return original content
    if (!finalDescription && !finalWhenToUse) {
      return content;
    }

    return updateFrontmatter({
      content: bodyContent,
      frontmatter: {
        description: finalDescription,
        whenToUse: finalWhenToUse,
      },
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
