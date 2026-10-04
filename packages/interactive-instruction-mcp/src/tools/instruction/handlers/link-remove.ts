import { z } from "zod";
import { BaseActionHandler, looseArray, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions } from "../types.js";
import { parseFrontmatter } from "../../../utils/frontmatter-parser.js";
import {
  textResponse,
  calculateNewRelatedDocs,
  deliberateLinkChange,
  loadLinkTarget,
  refuseMissingDocument,
  formatRelatedDocs,
  reportNoChange,
  writeRelatedDocs,
} from "./link-shared.js";

const schema = z.object({
  action: z.literal("link_remove"),
  id: z.string().describe("Document ID to remove links from"),
  relatedDocs: looseArray(z.array(z.string()).describe("Document IDs to remove from related")),
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
  readonly help = "Remove relatedDocs links from a document's frontmatter. Needs `explanation`, and the identical call repeated.";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { id, relatedDocs, explanation } = params.args;
    const { reader } = params.context;

    const target = await loadLinkTarget({ reader, id });
    if (target === null) {
      return refuseMissingDocument(id);
    }

    return this.removeLinks({ reader, id, relatedDocs, explanation, target });
  }

  /** The change itself, once the document is known to exist. */
  private async removeLinks(params: {
    reader: InstructionContext["reader"];
    id: string;
    relatedDocs: string[];
    explanation: string;
    target: { storageId: string; content: string };
  }): Promise<ToolResponse> {
    const { reader, id, relatedDocs, explanation, target } = params;
    const { storageId, content } = target;

    const frontmatter = parseFrontmatter(content);
    const currentRelated = frontmatter.relatedDocs || [];

    // Calculate new relatedDocs
    const calcResult = calculateNewRelatedDocs({
      isAdd: false,
      currentRelated,
      relatedDocs,
    });

    if (calcResult.noChange) {
      return reportNoChange({ id, message: calcResult.message });
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
      work: () => this.applyLink({ reader, id, storageId, content, frontmatter, newRelated }),
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

**Current relatedDocs:** ${formatRelatedDocs(currentRelated)}

**Removing:** ${changedDocs.join(", ")}

**New relatedDocs:** ${formatRelatedDocs(newRelated)}`
    );
  }

  private async applyLink(params: {
    reader: InstructionContext["reader"];
    /** What the caller called it, and what the response says. */
    id: string;
    /** Where it is stored, which is the same thing unless it is a draft. */
    storageId: string;
    content: string;
    frontmatter: ReturnType<typeof parseFrontmatter>;
    newRelated: string[];
  }): Promise<ToolResponse> {
    const { reader, id, storageId, content, frontmatter, newRelated } = params;

    const failure = await writeRelatedDocs({ reader, storageId, content, frontmatter, newRelated });
    if (failure !== null) {
      return errorResponse(`Error: ${failure.error}`);
    }

    return textResponse(
      `Successfully removed relatedDocs for "${id}".

**New relatedDocs:** ${formatRelatedDocs(newRelated)}` +
      formatNextActions([
        { action: "read", description: "Read the document", example: `instruction(action: "read", id: "${id}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }
}
