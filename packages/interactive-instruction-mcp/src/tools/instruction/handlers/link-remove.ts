import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { requestApproval, validateApproval, getApprovalRequestedMessage, getApprovalRejectionMessage } from "mcp-shared/approval";
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
  buildLinkApprovalWhat,
} from "./link-shared.js";

const schema = z.object({
  action: z.literal("link_remove"),
  id: z.string().describe("Document ID to remove links from"),
  relatedDocs: z.array(z.string()).describe("Document IDs to remove from related"),
  confirmed: z.boolean().optional(),
  approvalToken: z.string().optional(),
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
    const { id, relatedDocs, confirmed, approvalToken } = params.args;
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

    // Preview mode
    if (!confirmed && !approvalToken) {
      return this.showPreview({ id, currentRelated, newRelated, relatedDocs });
    }

    // Request approval
    if (confirmed && !approvalToken) {
      return this.requestLinkApproval({ id, relatedDocs, newRelated });
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
  }): ToolResponse {
    const { id, currentRelated, newRelated, relatedDocs } = params;
    const changedDocs = relatedDocs.filter((d) => currentRelated.includes(d));

    return textResponse(
      `## Preview: Removing relatedDocs

**Document:** ${id}

**Current relatedDocs:** ${currentRelated.length > 0 ? currentRelated.join(", ") : "(none)"}

**Removing:** ${changedDocs.join(", ")}

**New relatedDocs:** ${newRelated.length > 0 ? newRelated.join(", ") : "(none)"}` +
      formatNextActions([{
        action: "link_remove",
        description: "Confirm and proceed",
        example: `instruction(action: "link_remove", id: "${id}", relatedDocs: ${JSON.stringify(relatedDocs)}, confirmed: true)`,
      }]),
    );
  }

  private async requestLinkApproval(params: {
    id: string;
    relatedDocs: string[];
    newRelated: string[];
  }): Promise<ToolResponse> {
    const { id, relatedDocs, newRelated } = params;
    const requestId = `instruction::link_remove::${id}`;

    const approvalResult = await requestApproval({
      request: {
        id: requestId,
        operation: "Link remove",
        description: `Remove relatedDocs for "${id}" -> [${newRelated.join(", ")}]`,
        what: buildLinkApprovalWhat({ linkAction: "link_remove", id, newRelated }),
      },
    });

    return textResponse(
      `# Approval Requested

**Document:** ${id}
**Action:** remove relatedDocs
**Changes:** ${relatedDocs.join(", ")}

${getApprovalRequestedMessage(approvalResult)}` +
      formatNextActions([{
        action: "link_remove",
        description: "Apply with token from user",
        example: `instruction(action: "link_remove", id: "${id}", relatedDocs: ${JSON.stringify(relatedDocs)}, approvalToken: "<token>")`,
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
    const requestId = `instruction::link_remove::${id}`;

    const validation = validateApproval({
      requestId,
      providedToken: approvalToken,
      currentWhat: buildLinkApprovalWhat({ linkAction: "link_remove", id, newRelated }),
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
