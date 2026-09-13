import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions } from "../types.js";
import {
  parseFrontmatter,
  updateFrontmatter,
} from "../../../utils/frontmatter-parser.js";
import * as fs from "node:fs/promises";
import { errorResponse } from "../types.js";
import {
  textResponse,
  findInvalidDocs,
  calculateNewRelatedDocs,
  deliberateLinkChange,
} from "./link-shared.js";

const schema = z.object({
  action: z.literal("link_remove"),
  id: z.string().describe("Document ID to remove links from"),
  relatedDocs: z.array(z.string()).describe("Document IDs to remove from related"),
  explanation: z
    .string()
    .min(1)
    .describe(
      "What removing these links means and why, in your own words, as you described it to the user. Required, and it must be identical across both attempts.",
    ),
});

type Args = z.infer<typeof schema>;

export class LinkRemoveHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "link_remove";
  readonly help = "Remove relatedDocs links from a document's frontmatter.";
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

    const frontmatter = parseFrontmatter(content);
    const currentRelated = frontmatter.relatedDocs || [];

    // Calculate new relatedDocs
    const calcResult = calculateNewRelatedDocs({
      isAdd: false,
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
      linkAction: "link_remove",
      id,
      newRelated,
      explanation,
      preview: this.buildPreview({ id, currentRelated, newRelated, relatedDocs }),
      work: () => this.applyLink({ reader, id, content, frontmatter, newRelated }),
    });
  }

  private buildPreview(params: {
    id: string;
    currentRelated: string[];
    newRelated: string[];
    relatedDocs: string[];
  }): string {
    const { id, currentRelated, newRelated, relatedDocs } = params;
    const changedDocs = relatedDocs.filter((d) => currentRelated.includes(d));

    return (
      `## Preview: Removing relatedDocs

**Document:** ${id}

**Current relatedDocs:** ${currentRelated.length > 0 ? currentRelated.join(", ") : "(none)"}

**Removing:** ${changedDocs.join(", ")}

**New relatedDocs:** ${newRelated.length > 0 ? newRelated.join(", ") : "(none)"}`
    );
  }

  /**
   * The write itself, once the gate has let it through. Failure is returned
   * rather than thrown, which is what decides that the run is over.
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
      `Successfully removed relatedDocs for "${id}".

**New relatedDocs:** ${newRelated.length > 0 ? newRelated.join(", ") : "(none)"}` +
      formatNextActions([
        { action: "read", description: "Read the document", example: `instruction(action: "read", id: "${id}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }
}
