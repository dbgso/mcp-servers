import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, textResponse } from "../types.js";
import { isInternalDocument } from "../../../constants.js";
import { parseFrontmatter, stripFrontmatter } from "../../../utils/frontmatter-parser.js";
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


/**
 * The headings of a markdown body, skipping fenced code.
 *
 * A `# comment` inside a shell block is not a section, and a document that
 * shows two similar commands would otherwise report a duplicate heading for
 * every example it contains.
 */
function headingsOf(body: string): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = [];
  let fence: string | null = null;

  for (const line of body.split("\n")) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1][0];
      // A fence closes only on its own kind, so a ``` inside a ~~~ block is
      // content rather than the end of it.
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      headings.push({ level: heading[1].length, text: heading[2].trim() });
    }
  }

  return headings;
}

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
    const documents = result.documents.filter((d) => !isInternalDocument(d.id));

    const issues: LintIssue[] = [];

    // Run all checks
    issues.push(...this.checkMissingMetadata({ documents }));
    issues.push(...this.checkOrphanedDocs({ documents }));
    issues.push(...(await this.checkDocumentSize({ reader, documents })));
    issues.push(...(await this.checkDuplicateHeadings({ reader, documents })));
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

  /**
   * Size, and what a document is allowed to say back about it.
   *
   * Line count is a proxy for "one topic, one claim", and the documents it is
   * wrong about are a recognisable kind: a reference table is worth more whole
   * than split across three files, and a runbook read out of order is not a
   * runbook. Raising the threshold does not help -- it just moves the line and
   * buries the documents that really should be split.
   *
   * So a document can exempt itself, but only by saying why. The reason is the
   * feature: it is what tells the next reader that a long document was a
   * decision rather than a warning nobody got to.
   */
  private async checkDocumentSize(params: {
    reader: MarkdownReader;
    documents: MarkdownSummary[];
  }): Promise<LintIssue[]> {
    const { reader, documents } = params;
    const issues: LintIssue[] = [];

    for (const doc of documents) {
      const content = await reader.getDocumentContent(doc.id);
      if (!content) continue;

      // The body only. Counting the frontmatter meant that describing a
      // document well spent its size budget: a fifth `whenToUse` entry is a
      // line against the limit, so the rule rewarded thin metadata and
      // eventually warned about documents whose prose was well within it.
      const lineCount = stripFrontmatter(content).split("\n").length;
      const tooLarge = lineCount > MAX_LINES;
      const exemption = parseFrontmatter(content).sizeExemption;
      const hasReason = exemption !== undefined && exemption.trim() !== "";

      if (exemption !== undefined && !hasReason) {
        issues.push({
          severity: "warning",
          docId: doc.id,
          rule: "size-exemption-without-reason",
          message:
            "`sizeExemption` needs a reason for keeping the document whole. " +
            "Without one it is a mute button, and the next reader cannot tell " +
            "a decision from an unaddressed warning.",
        });
      }

      if (tooLarge && !hasReason) {
        issues.push({
          severity: "warning",
          docId: doc.id,
          rule: "document-too-large",
          message:
            `Document body has ${lineCount} lines (max recommended: ${MAX_LINES}). ` +
            "Consider splitting, or set `sizeExemption` to say why it stays whole.",
        });
      }

      if (!tooLarge && hasReason) {
        // Nothing else would ever mention it again, and a stale exemption is
        // how the next long document gets waved through.
        issues.push({
          severity: "info",
          docId: doc.id,
          rule: "stale-size-exemption",
          message:
            `Document body is ${lineCount} lines, within the limit, but still carries ` +
            "`sizeExemption`. Remove it, or the exemption outlives the reason for it.",
        });
      }
    }

    return issues;
  }

  /**
   * The same heading twice in one document.
   *
   * A more specific signal than length, and a different one: it is what
   * appending to a document looks like. A `## Related` in the middle and
   * another at the end means a section was added after the one that was
   * already there rather than into it -- and in the case this came from, the
   * appended part turned out to be a separable topic.
   *
   * Reported whatever the document's size says, including when it is exempt:
   * being deliberately long says nothing about the structure being sound.
   */
  private async checkDuplicateHeadings(params: {
    reader: MarkdownReader;
    documents: MarkdownSummary[];
  }): Promise<LintIssue[]> {
    const { reader, documents } = params;
    const issues: LintIssue[] = [];

    for (const doc of documents) {
      const content = await reader.getDocumentContent(doc.id);
      if (!content) continue;

      const counts = new Map<string, { level: number; text: string; times: number }>();
      for (const heading of headingsOf(stripFrontmatter(content))) {
        // Keyed by level as well as text: `# Setup` with a `## Setup` under it
        // is nesting, not a section that came back.
        const key = `${heading.level}:${heading.text.toLowerCase()}`;
        const seen = counts.get(key);
        counts.set(key, { ...heading, times: (seen?.times ?? 0) + 1 });
      }

      for (const { level, text, times } of counts.values()) {
        if (times < 2) continue;
        issues.push({
          severity: "warning",
          docId: doc.id,
          rule: "duplicate-heading",
          message:
            `"${"#".repeat(level)} ${text}" appears ${times} times. ` +
            "A section that comes back usually means something was appended to the " +
            "end of the document rather than into it; the later part is often a " +
            "topic of its own.",
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
