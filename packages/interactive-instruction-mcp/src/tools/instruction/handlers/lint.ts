import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, textResponse } from "../types.js";
import { DRAFT_DIR } from "../../../constants.js";
import type { MarkdownSummary } from "../../../types/index.js";
import type { MarkdownReader } from "../../../services/markdown-reader.js";

const schema = z.object({
  action: z.literal("lint"),
});

type Args = z.infer<typeof schema>;

interface LintIssue {
  severity: "error" | "warning" | "info";
  docId: string;
  rule: string;
  message: string;
}

const MAX_LINES = 150;
const SIMILARITY_THRESHOLD = 0.6;


export class LintHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "lint";
  readonly help = "Run quality checks on all documents (missing metadata, orphans, size, similarity, circular refs).";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { reader } = params.context;

    const result = await reader.listDocuments({ recursive: true });
    const documents = result.documents.filter((d) => !d.id.startsWith(DRAFT_DIR));

    const issues: LintIssue[] = [];

    // Run all checks
    issues.push(...this.checkMissingMetadata({ documents }));
    issues.push(...this.checkOrphanedDocs({ documents }));
    issues.push(...(await this.checkDocumentSize({ reader, documents })));
    issues.push(...this.checkSimilarDocs({ documents }));
    issues.push(...this.checkCircularReferences({ documents }));

    if (issues.length === 0) {
      return textResponse(
        "No issues found. All documents follow best practices." +
        formatNextActions([{
          action: "list",
          description: "View all documents",
          example: `instruction(action: "list")`,
        }]),
      );
    }

    // Sort by severity
    const severityOrder = { error: 0, warning: 1, info: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    // Format output
    const lines = ["# Document Lint Results", "", `Found ${issues.length} issue(s):`, ""];

    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warningCount = issues.filter((i) => i.severity === "warning").length;
    const infoCount = issues.filter((i) => i.severity === "info").length;

    if (errorCount > 0) lines.push(`- Errors: ${errorCount}`);
    if (warningCount > 0) lines.push(`- Warnings: ${warningCount}`);
    if (infoCount > 0) lines.push(`- Info: ${infoCount}`);
    lines.push("");

    for (const issue of issues) {
      const icon =
        issue.severity === "error"
          ? "x"
          : issue.severity === "warning"
            ? "!"
            : "i";
      lines.push(`[${icon}] **${issue.docId}**: ${issue.message}`);
      lines.push(`   Rule: ${issue.rule}`);
      lines.push("");
    }

    return textResponse(
      lines.join("\n") +
      formatNextActions([
        { action: "update_meta", description: "Update metadata for a document", example: `instruction(action: "update_meta", id: "<doc-id>")` },
        { action: "link_add", description: "Add related documents", example: `instruction(action: "link_add", id: "<doc-id>", relatedDocs: ["other-doc"])` },
      ]),
    );
  }

  private checkMissingMetadata(params: {
    documents: MarkdownSummary[];
  }): LintIssue[] {
    const { documents } = params;
    const issues: LintIssue[] = [];

    for (const doc of documents) {
      const noDescription =
        !doc.description ||
        doc.description === "(No description)" ||
        doc.description.trim() === "";

      if (noDescription) {
        issues.push({
          severity: "error",
          docId: doc.id,
          rule: "missing-description",
          message: "Missing description in frontmatter",
        });
      }

      if (!doc.whenToUse || doc.whenToUse.length === 0) {
        issues.push({
          severity: "warning",
          docId: doc.id,
          rule: "missing-when-to-use",
          message: "Missing whenToUse in frontmatter",
        });
      }
    }

    return issues;
  }

  private checkOrphanedDocs(params: {
    documents: MarkdownSummary[];
  }): LintIssue[] {
    const { documents } = params;
    const issues: LintIssue[] = [];

    const referencedDocs = new Set<string>();
    for (const doc of documents) {
      if (doc.relatedDocs) {
        for (const ref of doc.relatedDocs) {
          referencedDocs.add(ref);
        }
      }
    }

    for (const doc of documents) {
      if (doc.id.startsWith("_")) continue;

      if (!referencedDocs.has(doc.id)) {
        issues.push({
          severity: "info",
          docId: doc.id,
          rule: "orphaned-document",
          message: "Not referenced by any other document (consider adding relatedDocs)",
        });
      }
    }

    return issues;
  }

  private async checkDocumentSize(params: {
    reader: MarkdownReader;
    documents: MarkdownSummary[];
  }): Promise<LintIssue[]> {
    const { reader, documents } = params;
    const issues: LintIssue[] = [];

    for (const doc of documents) {
      const content = await reader.getDocumentContent(doc.id);
      if (!content) continue;

      const lineCount = content.split("\n").length;
      if (lineCount > MAX_LINES) {
        issues.push({
          severity: "warning",
          docId: doc.id,
          rule: "document-too-large",
          message: `Document has ${lineCount} lines (max recommended: ${MAX_LINES}). Consider splitting.`,
        });
      }
    }

    return issues;
  }

  private checkSimilarDocs(params: {
    documents: MarkdownSummary[];
  }): LintIssue[] {
    const { documents } = params;
    const issues: LintIssue[] = [];
    const checked = new Set<string>();

    for (let i = 0; i < documents.length; i++) {
      for (let j = i + 1; j < documents.length; j++) {
        const doc1 = documents[i];
        const doc2 = documents[j];
        const pairKey = `${doc1.id}:${doc2.id}`;

        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        const title1 = this.extractTitle(doc1.id);
        const title2 = this.extractTitle(doc2.id);
        const titleSimilarity = this.calculateSimilarity({ str1: title1, str2: title2 });

        const whenToUse1 = (doc1.whenToUse || []).join(" ").toLowerCase();
        const whenToUse2 = (doc2.whenToUse || []).join(" ").toLowerCase();
        const whenToUseSimilarity = this.calculateSimilarity({ str1: whenToUse1, str2: whenToUse2 });

        if (titleSimilarity > SIMILARITY_THRESHOLD) {
          issues.push({
            severity: "info",
            docId: doc1.id,
            rule: "similar-documents",
            message: `Similar to "${doc2.id}" (title similarity: ${Math.round(titleSimilarity * 100)}%). Consider merging or clarifying distinction.`,
          });
        } else if (whenToUseSimilarity > SIMILARITY_THRESHOLD && whenToUse1.length > 10) {
          issues.push({
            severity: "info",
            docId: doc1.id,
            rule: "similar-use-cases",
            message: `Similar use cases to "${doc2.id}". Consider merging or adding relatedDocs.`,
          });
        }
      }
    }

    return issues;
  }

  private checkCircularReferences(params: {
    documents: MarkdownSummary[];
  }): LintIssue[] {
    const { documents } = params;
    const issues: LintIssue[] = [];

    const refs = new Map<string, string[]>();
    for (const doc of documents) {
      refs.set(doc.id, doc.relatedDocs || []);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const reportedCycles = new Set<string>();

    const dfs = (params: { docId: string; path: string[] }): void => {
      const { docId, path } = params;
      if (inStack.has(docId)) {
        const cycleStart = path.indexOf(docId);
        const cycle = path.slice(cycleStart);
        const cycleKey = [...cycle].sort().join(",");

        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          issues.push({
            severity: "warning",
            docId: cycle[0],
            rule: "circular-reference",
            message: `Circular reference detected: ${cycle.join(" -> ")} -> ${docId}`,
          });
        }
        return;
      }

      if (visited.has(docId)) return;

      visited.add(docId);
      inStack.add(docId);

      const related = refs.get(docId) || [];
      for (const ref of related) {
        if (refs.has(ref)) {
          dfs({ docId: ref, path: [...path, docId] });
        }
      }

      inStack.delete(docId);
    };

    for (const doc of documents) {
      if (!visited.has(doc.id)) {
        dfs({ docId: doc.id, path: [] });
      }
    }

    return issues;
  }

  private extractTitle(id: string): string {
    const parts = id.split("__");
    return parts[parts.length - 1].replace(/-/g, " ").toLowerCase();
  }

  private calculateSimilarity(params: { str1: string; str2: string }): number {
    const { str1, str2 } = params;
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const words1 = new Set(str1.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const words2 = new Set(str2.toLowerCase().split(/\s+/).filter((w) => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }
}
