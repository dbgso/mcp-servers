import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext } from "../../../types/index.js";
import type { MarkdownReader } from "../../../services/markdown-reader.js";
import {
  parseFrontmatter,
  updateFrontmatter,
} from "../../../utils/frontmatter-parser.js";
import {
  requestApproval,
  validateApproval,
  getApprovalRequestedMessage,
  getApprovalRejectionMessage,
} from "mcp-shared";
import * as fs from "node:fs/promises";

interface PendingLinkChange {
  id: string;
  linkAction: "link_add" | "link_remove";
  relatedDocs: string[];
  timestamp: number;
}

const pendingChanges = new Map<string, PendingLinkChange>();

export class LinkHandler implements DraftActionHandler {
  async execute(params: {
    actionParams: DraftActionParams;
    context: DraftActionContext;
  }): Promise<ToolResult> {
    const { id, relatedDocs, confirmed, approvalToken } = params.actionParams;
    const { reader } = params.context;
    const linkAction = params.actionParams.action as "link_add" | "link_remove";

    // Validate required params
    if (!id) {
      return this.errorResult("id is required");
    }

    if (!relatedDocs || relatedDocs.length === 0) {
      return this.errorResult("relatedDocs is required (at least one document ID)");
    }

    // Check if document exists
    const content = await reader.getDocumentContent(id);
    if (content === null) {
      return this.errorResult(`Document "${id}" not found.`);
    }

    // Validate that target documents exist
    const invalidDocs = await this.findInvalidDocs({ reader, relatedDocs });
    if (invalidDocs.length > 0) {
      return this.errorResult(`The following documents do not exist: ${invalidDocs.join(", ")}`);
    }

    const frontmatter = parseFrontmatter(content);
    const currentRelated = frontmatter.relatedDocs || [];
    const isAdd = linkAction === "link_add";

    // Calculate new relatedDocs
    const calcResult = this.calculateNewRelatedDocs({
      isAdd,
      currentRelated,
      relatedDocs,
    });

    if (calcResult.noChange) {
      return this.successResult(calcResult.message);
    }

    const newRelated = calcResult.newRelated;

    // Preview mode
    if (!confirmed && !approvalToken) {
      return this.showPreview({ id, linkAction, currentRelated, newRelated, relatedDocs });
    }

    // Request approval
    if (confirmed && !approvalToken) {
      return this.requestLinkApproval({ id, linkAction, relatedDocs });
    }

    // Apply with token
    if (approvalToken) {
      return this.applyLink({
        reader,
        id,
        linkAction,
        approvalToken,
        content,
        frontmatter,
        newRelated,
      });
    }

    return this.errorResult("Unexpected state");
  }

  private async findInvalidDocs(params: {
    reader: MarkdownReader;
    relatedDocs: string[];
  }): Promise<string[]> {
    const { reader, relatedDocs } = params;
    const invalidDocs: string[] = [];
    for (const docId of relatedDocs) {
      const exists = await reader.documentExists(docId);
      if (!exists) {
        invalidDocs.push(docId);
      }
    }
    return invalidDocs;
  }

  private calculateNewRelatedDocs(params: {
    isAdd: boolean;
    currentRelated: string[];
    relatedDocs: string[];
  }): { noChange: boolean; message: string; newRelated: string[] } {
    const { isAdd, currentRelated, relatedDocs } = params;

    if (isAdd) {
      const toAdd = relatedDocs.filter((d) => !currentRelated.includes(d));
      if (toAdd.length === 0) {
        return {
          noChange: true,
          message: "All specified documents are already in relatedDocs.",
          newRelated: currentRelated,
        };
      }
      return {
        noChange: false,
        message: "",
        newRelated: [...currentRelated, ...toAdd],
      };
    }

    // Remove
    const toRemove = relatedDocs.filter((d) => currentRelated.includes(d));
    if (toRemove.length === 0) {
      return {
        noChange: true,
        message: "None of the specified documents are in relatedDocs.",
        newRelated: currentRelated,
      };
    }
    return {
      noChange: false,
      message: "",
      newRelated: currentRelated.filter((d) => !relatedDocs.includes(d)),
    };
  }

  private showPreview(params: {
    id: string;
    linkAction: "link_add" | "link_remove";
    currentRelated: string[];
    newRelated: string[];
    relatedDocs: string[];
  }): ToolResult {
    const { id, linkAction, currentRelated, newRelated, relatedDocs } = params;
    const isAdd = linkAction === "link_add";
    const changeType = isAdd ? "Adding" : "Removing";
    const changedDocs = isAdd
      ? relatedDocs.filter((d) => !currentRelated.includes(d))
      : relatedDocs.filter((d) => currentRelated.includes(d));

    const actionName = isAdd ? "link_add" : "link_remove";

    const text = `## Preview: ${changeType} relatedDocs

**Document:** ${id}

**Current relatedDocs:** ${currentRelated.length > 0 ? currentRelated.join(", ") : "(none)"}

**${changeType}:** ${changedDocs.join(", ")}

**New relatedDocs:** ${newRelated.length > 0 ? newRelated.join(", ") : "(none)"}

---

To proceed, call:
\`\`\`
draft(action: "${actionName}", id: "${id}", relatedDocs: ${JSON.stringify(relatedDocs)}, confirmed: true)
\`\`\``;

    return this.successResult(text);
  }

  private async requestLinkApproval(params: {
    id: string;
    linkAction: "link_add" | "link_remove";
    relatedDocs: string[];
  }): Promise<ToolResult> {
    const { id, linkAction, relatedDocs } = params;
    const requestId = `${linkAction}-${id}`;
    const isAdd = linkAction === "link_add";

    pendingChanges.set(id, {
      id,
      linkAction,
      relatedDocs,
      timestamp: Date.now(),
    });

    const approvalResult = await requestApproval({
      request: {
        id: requestId,
        operation: `Link ${isAdd ? "add" : "remove"}`,
        description: `${isAdd ? "add" : "remove"} relatedDocs for "${id}"`,
      },
    });

    const actionName = isAdd ? "link_add" : "link_remove";

    const text = `# Approval Requested

**Document:** ${id}
**Action:** ${isAdd ? "add" : "remove"} relatedDocs
**Changes:** ${relatedDocs.join(", ")}

${getApprovalRequestedMessage(approvalResult.fallbackPath)}

When user provides the token, call:
\`\`\`
draft(action: "${actionName}", id: "${id}", relatedDocs: ${JSON.stringify(relatedDocs)}, approvalToken: "<token>")
\`\`\``;

    return this.successResult(text);
  }

  private async applyLink(params: {
    reader: MarkdownReader;
    id: string;
    linkAction: "link_add" | "link_remove";
    approvalToken: string;
    content: string;
    frontmatter: ReturnType<typeof parseFrontmatter>;
    newRelated: string[];
  }): Promise<ToolResult> {
    const { reader, id, linkAction, approvalToken, content, frontmatter, newRelated } = params;
    const requestId = `${linkAction}-${id}`;
    const isAdd = linkAction === "link_add";

    const pending = pendingChanges.get(id);
    if (!pending) {
      return this.errorResult(
        `No pending change found for "${id}". Please start the approval workflow again.`
      );
    }

    const validation = validateApproval({
      requestId,
      providedToken: approvalToken,
    });

    if (!validation.valid) {
      return this.errorResult(
        `${getApprovalRejectionMessage()}\n\nReason: ${validation.reason}`
      );
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

    const text = `Successfully ${isAdd ? "added" : "removed"} relatedDocs for "${id}".

**New relatedDocs:** ${newRelated.length > 0 ? newRelated.join(", ") : "(none)"}`;

    return this.successResult(text);
  }

  private errorResult(message: string): ToolResult {
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }

  private successResult(text: string): ToolResult {
    return {
      content: [{ type: "text" as const, text }],
    };
  }
}
