import type { ToolResult, DraftActionHandler, DraftActionParams, DraftActionContext } from "../../../types/index.js";
import type { MarkdownReader } from "../../../services/markdown-reader.js";
import type { MarkdownSummary } from "../../../types/index.js";
import { DRAFT_DIR } from "../../../constants.js";

interface LintIssue {
  severity: "error" | "warning" | "info";
  docId: string;
  rule: string;
  message: string;
}

const MAX_LINES = 150;
const SIMILARITY_THRESHOLD = 0.6;

export class LintHandler implements DraftActionHandler {
  async execute(params: {
    actionParams: DraftActionParams;
    context: DraftActionContext;
  }): Promise<ToolResult> {
    const { reader } = params.context;

    const result = await reader.listDocuments({ recursive: true });
    const documents = result.documents.filter(d => !d.id.startsWith(DRAFT_DIR));

    const issues: LintIssue[] = [];

    // Run all checks
    issues.push(...this.checkMissingMetadata({ documents }));
    issues.push(...this.checkOrphanedDocs({ documents }));
    issues.push(...await this.checkDocumentSize({ reader, documents }));
    issues.push(...this.checkSimilarDocs({ documents }));
    issues.push(...this.checkCircularReferences({ documents }));

    if (issues.length === 0) {
      return this.successResult("No issues found. All documents follow best practices.");
    }

    // Sort by severity
    const severityOrder = { error: 0, warning: 1, info: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    // Format output
    const lines = ["# Document Lint Results", "", `Found ${issues.length} issue(s):`, ""];

    const errorCount = issues.filter(i => i.severity === "error").length;
    const warningCount = issues.filter(i => i.severity === "warning").length;
    const infoCount = issues.filter(i => i.severity === "info").length;

    if (errorCount > 0) lines.push(`- Errors: ${errorCount}`);
    if (warningCount > 0) lines.push(`- Warnings: ${warningCount}`);
    if (infoCount > 0) lines.push(`- Info: ${infoCount}`);
    lines.push("");

    for (const issue of issues) {
      const icon = issue.severity === "error" ? "❌" : issue.severity === "warning" ? "⚠️" : "ℹ️";
      lines.push(`${icon} **${issue.docId}**: ${issue.message}`);
      lines.push(`   Rule: ${issue.rule}`);
      lines.push("");
    }

    return this.successResult(lines.join("\n"));
  }

  private checkMissingMetadata(params: {
    documents: MarkdownSummary[];
  }): LintIssue[] {
    const { documents } = params;
    const issues: LintIssue[] = [];

    for (const doc of documents) {
      // Check description is missing or placeholder
      const noDescription = !doc.description ||
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

      // Check whenToUse is missing
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

    // Build set of all referenced docs
    const referencedDocs = new Set<string>();
    for (const doc of documents) {
      if (doc.relatedDocs) {
        for (const ref of doc.relatedDocs) {
          referencedDocs.add(ref);
        }
      }
    }

    // Find orphaned docs (not referenced by anyone)
    for (const doc of documents) {
      // Skip internal/system docs
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

        // Check title similarity (extract from ID)
        const title1 = this.extractTitle(doc1.id);
        const title2 = this.extractTitle(doc2.id);
        const titleSimilarity = this.calculateSimilarity({ str1: title1, str2: title2 });

        // Check whenToUse similarity
        const whenToUse1 = (doc1.whenToUse || []).join(" ").toLowerCase();
        const whenToUse2 = (doc2.whenToUse || []).join(" ").toLowerCase();
        const whenToUseSimilarity = this.calculateSimilarity({ str1: whenToUse1, str2: whenToUse2 });

        // Similar titles might indicate duplicates
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

    // Build adjacency map
    const refs = new Map<string, string[]>();
    for (const doc of documents) {
      refs.set(doc.id, doc.relatedDocs || []);
    }

    // Find circular references using DFS
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const reportedCycles = new Set<string>();

    const dfs = (docId: string, path: string[]): void => {
      if (inStack.has(docId)) {
        // Found cycle
        const cycleStart = path.indexOf(docId);
        const cycle = path.slice(cycleStart);
        const cycleKey = [...cycle].sort().join(",");

        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          issues.push({
            severity: "warning",
            docId: cycle[0],
            rule: "circular-reference",
            message: `Circular reference detected: ${cycle.join(" → ")} → ${docId}`,
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
          dfs(ref, [...path, docId]);
        }
      }

      inStack.delete(docId);
    };

    for (const doc of documents) {
      if (!visited.has(doc.id)) {
        dfs(doc.id, []);
      }
    }

    return issues;
  }

  private extractTitle(id: string): string {
    // Extract the last part of the ID as title
    const parts = id.split("__");
    return parts[parts.length - 1].replace(/-/g, " ").toLowerCase();
  }

  private calculateSimilarity(params: { str1: string; str2: string }): number {
    const { str1, str2 } = params;
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    // Simple word-based Jaccard similarity
    const words1 = new Set(str1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(str2.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  private successResult(text: string): ToolResult {
    return {
      content: [{ type: "text" as const, text }],
    };
  }
}
