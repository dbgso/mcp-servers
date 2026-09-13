import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { requestApproval, validateApproval, getApprovalRequestedMessage, getApprovalRejectionMessage } from "mcp-shared/approval";
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
  pendingChanges,
} from "./link-shared.js";

const schema = z.object({
  action: z.literal("link_add"),
  id: z.string().describe("Document ID to add links to"),
  relatedDocs: z.array(z.string()).describe("Document IDs to add as related"),
  confirmed: z.boolean().optional(),
  approvalToken: z.string().optional(),
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
    const { id, relatedDocs, confirmed, approvalToken } = params.args;
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

    // Preview mode
    if (!confirmed && !approvalToken) {
      return this.showPreview({ id, currentRelated, newRelated, relatedDocs, circularWarnings });
    }

    // Request approval
    if (confirmed && !approvalToken) {
      return this.requestLinkApproval({ id, relatedDocs });
    }

    // Apply with token
    if (approvalToken) {
      return this.applyLink({
        reader,
        id,
        approvalToken,
        content,
        frontmatter,
        newRelated,
      });
    }

    return errorResponse("Error: Unexpected state");
  }

  private showPreview(params: {
    id: string;
    currentRelated: string[];
    newRelated: string[];
    relatedDocs: string[];
    circularWarnings: string[];
  }): ToolResponse {
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

    return textResponse(
      `## Preview: Adding relatedDocs

**Document:** ${id}

**Current relatedDocs:** ${currentRelated.length > 0 ? currentRelated.join(", ") : "(none)"}

**Adding:** ${changedDocs.join(", ")}

**New relatedDocs:** ${newRelated.length > 0 ? newRelated.join(", ") : "(none)"}
${warningSection}` +
      formatNextActions([{
        action: "link_add",
        description: "Confirm and proceed",
        example: `instruction(action: "link_add", id: "${id}", relatedDocs: ${JSON.stringify(relatedDocs)}, confirmed: true)`,
      }]),
    );
  }

  private async requestLinkApproval(params: {
    id: string;
    relatedDocs: string[];
  }): Promise<ToolResponse> {
    const { id, relatedDocs } = params;
    const requestId = `instruction::link_add::${id}`;

    pendingChanges.set(id, {
      id,
      linkAction: "link_add",
      relatedDocs,
      timestamp: Date.now(),
    });

    const approvalResult = await requestApproval({
      request: {
        id: requestId,
        operation: "Link add",
        description: `Add relatedDocs for "${id}"`,
      },
    });

    return textResponse(
      `# Approval Requested

**Document:** ${id}
**Action:** add relatedDocs
**Changes:** ${relatedDocs.join(", ")}

${getApprovalRequestedMessage(approvalResult)}` +
      formatNextActions([{
        action: "link_add",
        description: "Apply with token from user",
        example: `instruction(action: "link_add", id: "${id}", relatedDocs: ${JSON.stringify(relatedDocs)}, approvalToken: "<token>")`,
      }]),
    );
  }

  private async applyLink(params: {
    reader: InstructionContext["reader"];
    id: string;
    approvalToken: string;
    content: string;
    frontmatter: ReturnType<typeof parseFrontmatter>;
    newRelated: string[];
  }): Promise<ToolResponse> {
    const { reader, id, approvalToken, content, frontmatter, newRelated } = params;
    const requestId = `instruction::link_add::${id}`;

    const pending = pendingChanges.get(id);
    if (!pending) {
      return errorResponse(`Error: No pending change found for "${id}". Please start the approval workflow again.`);
    }

    const validation = validateApproval({
      requestId,
      providedToken: approvalToken,
    });

    if (!validation.valid) {
      return errorResponse(`${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`);
    }

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

    pendingChanges.delete(id);

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
