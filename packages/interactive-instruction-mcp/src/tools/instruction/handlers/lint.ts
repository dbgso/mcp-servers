import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, textResponse } from "../types.js";
import { DRAFT_PREFIX, isInternalDocument, isTrashedDocument } from "../../../constants.js";
import {
  checkDocument,
  configuredSimilarityThreshold,
  severityIcon,
  type LintIssue,
} from "../../../services/document-lint.js";
import type { MarkdownSummary } from "../../../types/index.js";

const schema = z.object({
  action: z.literal("lint"),
});

/**
 * What to call a document in the report.
 *
 * A draft is stored under `_mcp_drafts__<id>`, but that is where the file is,
 * not what anything else calls it: every other action takes the plain id, so
 * printing the prefixed one would name something the caller cannot act on.
 */
function displayId(id: string): string {
  return id.startsWith(DRAFT_PREFIX) ? `${id.slice(DRAFT_PREFIX.length)} (draft)` : id;
}

type Args = z.infer<typeof schema>;

export class LintHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "lint";
  readonly help =
    "Run quality checks. A draft is held to the rules it can answer on its own (size, repeated " +
    "headings, missing metadata); orphans, similarity and circular references are reported for the " +
    "promoted corpus only. The trash is never checked.";
  readonly schema = schema;

  protected async doExecute(params: {
    args: Args;
    context: InstructionContext;
  }): Promise<ToolResponse> {
    const { reader } = params.context;

    const result = await reader.listDocuments({ recursive: true });

    // Two scopes, decided by what a rule can answer rather than by where the
    // document lives.
    //
    // A rule a document answers on its own means the same thing before and
    // after promotion: a draft forty lines over the limit is over it now, and
    // the author is the one person who still remembers why. Those used to stop
    // at the corpus boundary because drafts share one "internal" predicate with
    // the trash directory -- a grouping argued for on the trash's behalf, never
    // on the draft's.
    //
    // A rule about the set cannot say anything useful about a draft. A draft is
    // usually a near-copy of what it will replace, so `checkSimilarDocs` fires
    // on almost every one -- about a resemblance that is the point rather than
    // a problem, and naming an id nothing else accepts.
    //
    // Two of the three rules need this, for different reasons. Similarity
    // fires on a draft against the document it is a draft of. And the orphan
    // check reads `relatedDocs` from every document it is handed while only
    // filtering which ids it *reports*, so a link written in a draft would
    // quietly un-orphan a promoted document -- a finding suppressed by a
    // document nobody has published yet.
    //
    // Cycles are the exception: a draft cannot enter one at all, because
    // `relatedDocs` stores plain ids while the graph is keyed by the stored
    // one, so a reference to a draft never resolves. It is excluded for
    // consistency, and there is nothing to assert about it -- a test would
    // pass with the exclusion removed.
    const documents = result.documents.filter((d) => !isTrashedDocument(d.id));
    const corpus = documents.filter((d) => !isInternalDocument(d.id));

    const issues: LintIssue[] = [];

    // Per document, drafts included: the same rules `add` and `update` report
    // at write time, so a document cannot be clean on the way in and dirty in
    // the report.
    for (const doc of documents) {
      const content = await reader.getDocumentContent(doc.id);
      if (content === null) continue;
      issues.push(...checkDocument({ docId: displayId(doc.id), content }));
    }

    // Corpus-wide: properties of the set, which no single write can decide.
    issues.push(...this.checkOrphanedDocs({ documents: corpus }));
    issues.push(...this.checkSimilarDocs({ documents: corpus }));
    issues.push(...this.checkCircularReferences({ documents: corpus }));

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
      lines.push(`[${severityIcon(issue.severity)}] **${issue.docId}**: ${issue.message}`);
      lines.push(`   Rule: ${issue.rule}`);
      lines.push("");
    }

    return textResponse(
      lines.join("\n") +
      formatNextActions([
        { action: "read_meta", description: "Update metadata for a document", example: `instruction(action: "read_meta", id: "<doc-id>")` },
        { action: "link_add", description: "Add related documents", example: `instruction(action: "link_add", id: "<doc-id>", relatedDocs: ["other-doc"], explanation: "<what the link means>")` },
      ]),
    );
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

  private checkSimilarDocs(params: {
    documents: MarkdownSummary[];
  }): LintIssue[] {
    const { documents } = params;
    const issues: LintIssue[] = [];
    const checked = new Set<string>();
    const threshold = configuredSimilarityThreshold();

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

        if (titleSimilarity > threshold) {
          issues.push({
            severity: "info",
            docId: doc1.id,
            rule: "similar-documents",
            message: `Similar to "${doc2.id}" (title similarity: ${Math.round(titleSimilarity * 100)}%). Consider merging or clarifying distinction.`,
          });
        } else if (whenToUseSimilarity > threshold && whenToUse1.length > 10) {
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
