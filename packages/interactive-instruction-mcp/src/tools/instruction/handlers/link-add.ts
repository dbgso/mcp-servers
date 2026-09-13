import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions } from "../types.js";
import {
  parseFrontmatter,
  updateFrontmatter,
} from "../../../utils/frontmatter-parser.js";
import * as fs from "node:fs/promises";
import {
  textResponse,
  findInvalidDocs,
  detectCircularReferences,
  calculateNewRelatedDocs,
  deliberateLinkChange,
} from "./link-shared.js";

const schema = z.object({
  action: z.literal("link_add"),
  id: z.string().describe("Document ID to add links to"),
  relatedDocs: z.array(z.string()).describe("Document IDs to add as related"),
  explanation: z
    .string()
    .min(1)
    .describe(
      "What these links mean and why you are adding them, in your own words, as you described them to the user. Required, and it must be identical across both attempts.",
    ),
});

type Args = z.infer<typeof schema>;

export class LinkAddHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "link_add";
  readonly help = "Add relatedDocs links to a document's frontmatter.";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, relatedDocs, explanation } = params.args;
    const { reader } = params.context;

    // Check if document exists
    const content = await reader.getDocumentContent(id);
    if (content === null) {
      return errorResponse(`Error: Document "${id}" not found.`);
    }

    // Validate that target documents exist
    const invalidDocs = await findInvalidDocs({ reader, relatedDocs });
    if (invalidDocs.length > 0) {
      return errorResponse(`Error: The following documents do not exist: ${invalidDocs.join(", ")}`);
    }

    const frontmatter = parseFrontmatter(content);
    const currentRelated = frontmatter.relatedDocs || [];

    // Check for circular references
    const circularWarnings = await detectCircularReferences({ reader, id, relatedDocs });

    // Calculate new relatedDocs
    const calcResult = calculateNewRelatedDocs({
      isAdd: true,
      currentRelated,
      relatedDocs,
    });

    if (calcResult.noChange) {
      return textResponse(
        calcResult.message +
        formatNextActions([{
          action: "read",
          description: "Read the document",
          example: `instruction(action: "read", id: "${id}")`,
        }]),
      );
    }

    const newRelated = calcResult.newRelated;

    // Every check that can refuse for free has run, so this is the last point
    // at which refusing costs nothing. The preview is shown by the refusal.
    return deliberateLinkChange({
      linkAction: "link_add",
      id,
      newRelated,
      explanation,
      preview: this.buildPreview({ id, currentRelated, newRelated, relatedDocs, circularWarnings }),
      work: () => this.applyLink({ reader, id, content, frontmatter, newRelated }),
    });
  }

  private buildPreview(params: {
    id: string;
    currentRelated: string[];
    newRelated: string[];
    relatedDocs: string[];
    circularWarnings: string[];
  }): string {
    const { id, currentRelated, newRelated, relatedDocs, circularWarnings } = params;
    const changedDocs = relatedDocs.filter((d) => !currentRelated.includes(d));

    let warningSection = "";
    if (circularWarnings.length > 0) {
      warningSection = `
**Warning: Circular reference detected**

Adding this link would create circular references:
${circularWarnings.map((w) => `- ${w}`).join("\n")}

Circular references are discouraged by lint rules. Consider using one-way links instead.

---
`;
    }

    return (
      `## Preview: Adding relatedDocs

**Document:** ${id}

**Current relatedDocs:** ${currentRelated.length > 0 ? currentRelated.join(", ") : "(none)"}

**Adding:** ${changedDocs.join(", ")}

**New relatedDocs:** ${newRelated.length > 0 ? newRelated.join(", ") : "(none)"}
${warningSection}`
    );
  }

  /**
   * The write itself, once the gate has let it through.
   *
   * Failure is reported by returning an error response rather than by throwing,
   * which is what `deliberateLinkChange` reads to decide whether the run is
   * over: an exception would mean something unforeseen, and would leave the run
   * standing rather than consuming it.
   */
  private async applyLink(params: {
    reader: InstructionContext["reader"];
    id: string;
    content: string;
    frontmatter: ReturnType<typeof parseFrontmatter>;
    newRelated: string[];
  }): Promise<ToolResponse> {
    const { reader, id, content, frontmatter, newRelated } = params;

    // Apply the change
    const newFrontmatter = {
      ...frontmatter,
      relatedDocs: newRelated.length > 0 ? newRelated : undefined,
    };

    const newContent = updateFrontmatter({
      content,
      frontmatter: newFrontmatter,
    });

    const filePath = reader.getFilePath(id);
    await fs.writeFile(filePath, newContent, "utf-8");
    reader.invalidateCache();


    return textResponse(
      `Successfully added relatedDocs for "${id}".

**New relatedDocs:** ${newRelated.join(", ")}` +
      formatNextActions([
        { action: "read", description: "Read the document", example: `instruction(action: "read", id: "${id}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }
}
