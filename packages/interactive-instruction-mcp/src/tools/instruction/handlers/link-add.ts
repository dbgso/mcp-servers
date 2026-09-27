import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { errorResponse, formatNextActions } from "../types.js";
import { parseFrontmatter } from "../../../utils/frontmatter-parser.js";
import {
  textResponse,
  findInvalidDocs,
  detectCircularReferences,
  calculateNewRelatedDocs,
  deliberateLinkChange,
  loadLinkTarget,
  refuseMissingDocument,
  formatRelatedDocs,
  reportNoChange,
  writeRelatedDocs,
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

/**
 * Spliced into the preview rather than refused outright: a cycle is discouraged
 * by lint, not forbidden, so the decision stays with the caller who has to
 * explain the change anyway.
 */
function circularWarningSection(circularWarnings: string[]): string {
  if (circularWarnings.length === 0) return "";

  return `
**Warning: Circular reference detected**

Adding this link would create circular references:
${circularWarnings.map((w) => `- ${w}`).join("\n")}

Circular references are discouraged by lint rules. Consider using one-way links instead.

---
`;
}

export class LinkAddHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "link_add";
  readonly help = "Add relatedDocs links to a document's frontmatter. Needs `explanation`, and the identical call repeated.";
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

    // Validate that target documents exist
    const invalidDocs = await findInvalidDocs({ reader, relatedDocs });
    if (invalidDocs.length > 0) {
      return errorResponse(`Error: The following documents do not exist: ${invalidDocs.join(", ")}`);
    }

    return this.addLinks({ reader, id, relatedDocs, explanation, target });
  }

  /** The change itself, once the document and every target is known to exist. */
  private async addLinks(params: {
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

    // Check for circular references
    const circularWarnings = await detectCircularReferences({ reader, id, relatedDocs });

    // Calculate new relatedDocs
    const calcResult = calculateNewRelatedDocs({
      isAdd: true,
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
      linkAction: "link_add",
      id,
      newRelated,
      explanation,
      preview: this.buildPreview({ id, currentRelated, newRelated, relatedDocs, circularWarnings }),
      work: () => this.applyLink({ reader, id, storageId, content, frontmatter, newRelated }),
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

    return (
      `## Preview: Adding relatedDocs

**Document:** ${id}

**Current relatedDocs:** ${formatRelatedDocs(currentRelated)}

**Adding:** ${changedDocs.join(", ")}

**New relatedDocs:** ${formatRelatedDocs(newRelated)}
${circularWarningSection(circularWarnings)}`
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
      `Successfully added relatedDocs for "${id}".

**New relatedDocs:** ${newRelated.join(", ")}` +
      formatNextActions([
        { action: "read", description: "Read the document", example: `instruction(action: "read", id: "${id}")` },
        { action: "list", description: "View all documents", example: `instruction(action: "list")` },
      ]),
    );
  }
}
