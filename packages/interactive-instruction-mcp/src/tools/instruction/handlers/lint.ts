import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { InstructionContext } from "../types.js";
import { formatNextActions, textResponse } from "../types.js";
import { DRAFT_PREFIX, isInternalDocument } from "../../../constants.js";
import {
  checkDocument,
  comparableBody,
  configuredMinDuplicateLines,
  configuredSimilarityThreshold,
  longestSharedRun,
  severityIcon,
  type LintIssue,
} from "../../../services/document-lint.js";
import type { MarkdownSummary } from "../../../types/index.js";
import type { MarkdownReader } from "../../../services/markdown-reader.js";
import {
  checkHubIndex,
  checkPrefersHub,
  childCandidates,
  childrenByParent,
  referencesOf,
  type HubDocument,
} from "../../../services/hub-lint.js";

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
  return id.startsWith(DRAFT_PREFIX) ? `${bareId(id)} (draft)` : id;
}

/**
 * The same id with nothing added, for an example call.
 *
 * `displayId` appends ` (draft)` so a reader can tell the two sets apart, and
 * that suffix is not part of any id. A finding whose message names the call that
 * answers it has to use this one, or it hands the caller a call that fails.
 */
function bareId(id: string): string {
  return id.startsWith(DRAFT_PREFIX) ? id.slice(DRAFT_PREFIX.length) : id;
}

type Args = z.infer<typeof schema>;

/** One document's body, already reduced to the lines worth comparing. */
type ComparableBody = { id: string; lines: string[] };

/** Every id that some document points at, so an orphan is one nobody points at. */
function referencedIds(documents: MarkdownSummary[]): Set<string> {
  return new Set(documents.flatMap((doc) => doc.relatedDocs ?? []));
}

/**
 * The direction is the whole of the advice. Saying only "not referenced" leaves
 * the caller to guess, and guessing wrong is what puts a document's parents
 * among its own children: `relatedDocs` edges run parent to child, so what has
 * to change is the parent's list, not this document's.
 */
function orphanIssue(docId: string): LintIssue {
  return {
    severity: "info",
    docId,
    rule: "orphaned-document",
    message:
      "Not referenced by any other document. Add it to the `relatedDocs` " +
      "of the document it belongs under -- edges run parent to child.",
  };
}

/** Nothing to find in a document shorter than the threshold. */
function tooShortToCompare(params: {
  first: ComparableBody;
  second: ComparableBody;
  minLines: number;
}): boolean {
  const { first, second, minLines } = params;
  return first.lines.length < minLines || second.lines.length < minLines;
}

/** The finding for one pair, or nothing when they share too little to matter. */
function copiedIssue(params: {
  first: ComparableBody;
  second: ComparableBody;
  minLines: number;
}): LintIssue[] {
  const { first, second, minLines } = params;
  if (tooShortToCompare({ first, second, minLines })) return [];

  const { lines, at } = longestSharedRun({ a: first.lines, b: second.lines });
  if (lines < minLines) return [];

  return [{
    severity: "warning",
    docId: displayId(first.id),
    rule: "copied-content",
    message:
      `${lines} lines are identical to "${displayId(second.id)}", starting at line ${at}. ` +
      "Two copies of a passage are maintained separately whether anyone means them to be: " +
      "keep it in one of them and link, or say in both why the repetition is deliberate.",
  }];
}

function joinedWhenToUse(doc: MarkdownSummary): string {
  return (doc.whenToUse || []).join(" ").toLowerCase();
}

function eitherIsEmpty(params: { str1: string; str2: string }): boolean {
  return !params.str1 || !params.str2;
}

/** Words too short to carry meaning are noise in an overlap count. */
function significantWords(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
}

/** Two texts with no significant words between them share nothing measurable. */
function jaccardOverlap(params: { words1: Set<string>; words2: Set<string> }): number {
  const { words1, words2 } = params;
  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/** A severity with nothing under it gets no line, rather than a zero. */
function severityCountLine(params: {
  issues: LintIssue[];
  severity: LintIssue["severity"];
  label: string;
}): string[] {
  const { issues, severity, label } = params;
  const count = issues.filter((i) => i.severity === severity).length;
  if (count === 0) return [];
  return [`- ${label}: ${count}`];
}

function severityCounts(issues: LintIssue[]): string[] {
  return [
    ...severityCountLine({ issues, severity: "error", label: "Errors" }),
    ...severityCountLine({ issues, severity: "warning", label: "Warnings" }),
    ...severityCountLine({ issues, severity: "info", label: "Info" }),
  ];
}

/** The findings, worst first, so the report opens on what needs doing. */
function formatReport(issues: LintIssue[]): string {
  const severityOrder = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const lines = [
    "# Document Lint Results",
    "",
    `Found ${sorted.length} issue(s):`,
    "",
    ...severityCounts(sorted),
    "",
  ];

  for (const issue of sorted) {
    lines.push(`[${severityIcon(issue.severity)}] **${issue.docId}**: ${issue.message}`);
    lines.push(`   Rule: ${issue.rule}`);
    lines.push("");
  }

  return lines.join("\n");
}

export class LintHandler extends BaseActionHandler<Args, InstructionContext> {
  readonly action = "lint";
  readonly help =
    "Run quality checks. A draft is held to the rules it can answer on its own (size, repeated " +
    "headings, missing metadata); orphans, similarity, hub structure and circular references are " +
    "reported for the promoted corpus only. The trash is never checked.";
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
    const documents = result.documents;
    const corpus = documents.filter((d) => !isInternalDocument(d.id));

    // Read once. Three of these rules want the body, and reading per rule meant
    // a rule could disagree with another about what a document said.
    const contents = await this.contentsOf({ reader, documents });

    const issues: LintIssue[] = [
      ...this.checkEachDocument({ documents, contents }),
      // Corpus-wide: properties of the set, which no single write can decide.
      ...this.checkOrphanedDocs({ documents: corpus }),
      ...this.checkSimilarDocs({ documents: corpus }),
      ...this.checkCopiedContent({ documents: corpus, contents }),
      ...this.checkHubStructure({ documents: corpus, contents }),
      ...this.checkCircularReferences({ documents: corpus }),
    ];

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

    return textResponse(
      formatReport(issues) +
      formatNextActions([
        { action: "read_meta", description: "Update metadata for a document", example: `instruction(action: "read_meta", id: "<doc-id>")` },
        { action: "link_add", description: "Add related documents", example: `instruction(action: "link_add", id: "<doc-id>", relatedDocs: ["other-doc"], explanation: "<what the link means>")` },
      ]),
    );
  }

  /**
   * Per document, drafts included: the same rules `add` and `update` report at
   * write time, so a document cannot be clean on the way in and dirty in the
   * report.
   */
  private checkEachDocument(params: {
    documents: MarkdownSummary[];
    contents: Map<string, string>;
  }): LintIssue[] {
    const { documents, contents } = params;
    const issues: LintIssue[] = [];

    for (const doc of documents) {
      const content = contents.get(doc.id);
      if (content === undefined) continue;
      issues.push(...checkDocument({ docId: displayId(doc.id), callId: bareId(doc.id), content }));
    }

    return issues;
  }

  /** Documents whose file could not be read drop out rather than read as empty. */
  private async contentsOf(params: {
    reader: MarkdownReader;
    documents: MarkdownSummary[];
  }): Promise<Map<string, string>> {
    const { reader, documents } = params;
    const contents = new Map<string, string>();

    for (const doc of documents) {
      const content = await reader.getDocumentContent(doc.id);
      if (content === null) continue;
      contents.set(doc.id, content);
    }

    return contents;
  }

  /**
   * The hub rules, which need the whole set and the bodies at once.
   *
   * A hub is an id other ids are built from *and* a document that exists --
   * `workflow__x` alone does not make `workflow` a hub, and telling a caller to
   * read a document that was never written is worse than the list it replaces.
   */
  private checkHubStructure(params: {
    documents: MarkdownSummary[];
    contents: Map<string, string>;
  }): LintIssue[] {
    const docs = this.hubDocuments(params);
    const ids = docs.map((doc) => doc.id);
    const existing = new Set(ids);
    const families = childrenByParent(ids);
    const hubs = new Set([...families.keys()].filter((id) => existing.has(id)));
    const candidates = childCandidates(ids);

    return docs.flatMap((doc) => {
      const referenced = referencesOf({ doc, candidates });
      return [
        ...checkPrefersHub({ doc, referenced, hubs }),
        ...this.hubIndexIssues({ doc, referenced, hubs, families }),
      ];
    });
  }

  private hubIndexIssues(params: {
    doc: HubDocument;
    referenced: Set<string>;
    hubs: Set<string>;
    families: Map<string, string[]>;
  }): LintIssue[] {
    const { doc, referenced, hubs, families } = params;
    if (!hubs.has(doc.id)) return [];
    return checkHubIndex({ hub: doc, children: families.get(doc.id) ?? [], referenced });
  }

  private hubDocuments(params: {
    documents: MarkdownSummary[];
    contents: Map<string, string>;
  }): HubDocument[] {
    const { documents, contents } = params;
    return documents
      .filter((doc) => contents.has(doc.id))
      .map((doc) => ({
        id: doc.id,
        relatedDocs: doc.relatedDocs,
        content: contents.get(doc.id) ?? "",
      }));
  }

  private checkOrphanedDocs(params: {
    documents: MarkdownSummary[];
  }): LintIssue[] {
    const { documents } = params;
    const referenced = referencedIds(documents);

    return documents
      .filter((doc) => !doc.id.startsWith("_") && !referenced.has(doc.id))
      .map((doc) => orphanIssue(doc.id));
  }

  /**
   * Passages one document has in common with another, word for word.
   *
   * `similar-documents` compares the id and `whenToUse`, so two documents can
   * share a hundred lines of body and neither the title nor the metadata says
   * so. That is how the same procedure ends up maintained in two places: the
   * copy is found when one of them is edited and the other is not, which is
   * exactly when finding it is too late.
   *
   * Reported as one issue per pair, naming where the run starts in the first of
   * them, because the fix is a single decision about the pair.
   */
  private checkCopiedContent(params: {
    documents: MarkdownSummary[];
    contents: Map<string, string>;
  }): LintIssue[] {
    const { documents, contents } = params;
    const minLines = configuredMinDuplicateLines();
    const bodies = this.comparableBodies({ documents, contents });

    const issues: LintIssue[] = [];
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        issues.push(...copiedIssue({ first: bodies[i], second: bodies[j], minLines }));
      }
    }

    return issues;
  }

  private comparableBodies(params: {
    documents: MarkdownSummary[];
    contents: Map<string, string>;
  }): ComparableBody[] {
    const { documents, contents } = params;
    const bodies: ComparableBody[] = [];

    for (const doc of documents) {
      const content = contents.get(doc.id);
      if (content === undefined) continue;
      bodies.push({ id: doc.id, lines: comparableBody(content) });
    }

    return bodies;
  }

  private checkSimilarDocs(params: {
    documents: MarkdownSummary[];
  }): LintIssue[] {
    const { documents } = params;
    const threshold = configuredSimilarityThreshold();
    const checked = new Set<string>();

    const issues: LintIssue[] = [];
    for (const [index, doc1] of documents.entries()) {
      issues.push(
        ...this.pairedWith({ doc1, rest: documents.slice(index + 1), threshold, checked }),
      );
    }

    return issues;
  }

  /** Each document against the ones after it, so every pair is judged once. */
  private pairedWith(params: {
    doc1: MarkdownSummary;
    rest: MarkdownSummary[];
    threshold: number;
    checked: Set<string>;
  }): LintIssue[] {
    const { doc1, rest, threshold, checked } = params;
    const issues: LintIssue[] = [];

    for (const doc2 of rest) {
      const pairKey = `${doc1.id}:${doc2.id}`;
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);

      issues.push(...this.similarityIssue({ doc1, doc2, threshold }));
    }

    return issues;
  }

  /** A pair resembling each other by title is not also reported by use case. */
  private similarityIssue(params: {
    doc1: MarkdownSummary;
    doc2: MarkdownSummary;
    threshold: number;
  }): LintIssue[] {
    const byTitle = this.similarTitleIssue(params);
    if (byTitle.length > 0) return byTitle;

    return this.similarUseCaseIssue(params);
  }

  private similarTitleIssue(params: {
    doc1: MarkdownSummary;
    doc2: MarkdownSummary;
    threshold: number;
  }): LintIssue[] {
    const { doc1, doc2, threshold } = params;
    const titleSimilarity = this.calculateSimilarity({
      str1: this.extractTitle(doc1.id),
      str2: this.extractTitle(doc2.id),
    });

    if (titleSimilarity <= threshold) return [];

    return [{
      severity: "info",
      docId: doc1.id,
      rule: "similar-documents",
      message: `Similar to "${doc2.id}" (title similarity: ${Math.round(titleSimilarity * 100)}%). Consider merging or clarifying distinction.`,
    }];
  }

  private similarUseCaseIssue(params: {
    doc1: MarkdownSummary;
    doc2: MarkdownSummary;
    threshold: number;
  }): LintIssue[] {
    const { doc1, doc2, threshold } = params;
    const whenToUse1 = joinedWhenToUse(doc1);
    const whenToUseSimilarity = this.calculateSimilarity({
      str1: whenToUse1,
      str2: joinedWhenToUse(doc2),
    });

    if (whenToUseSimilarity > threshold && whenToUse1.length > 10) {
      return [{
        severity: "info",
        docId: doc1.id,
        rule: "similar-use-cases",
        message: `Similar use cases to "${doc2.id}". Consider merging or adding relatedDocs.`,
      }];
    }

    return [];
  }

  private checkCircularReferences(params: {
    documents: MarkdownSummary[];
  }): LintIssue[] {
    const { documents } = params;
    const issues: LintIssue[] = [];

    const refs = new Map(documents.map((doc) => [doc.id, doc.relatedDocs || []]));

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const reportedCycles = new Set<string>();

    const related = (docId: string): string[] => refs.get(docId) || [];

    /** One finding per cycle: the same loop entered from three of its members is one cycle. */
    const reportCycle = (cycleParams: { docId: string; path: string[] }): void => {
      const { docId, path } = cycleParams;
      const cycleStart = path.indexOf(docId);
      const cycle = path.slice(cycleStart);
      const cycleKey = [...cycle].sort().join(",");

      if (reportedCycles.has(cycleKey)) return;

      reportedCycles.add(cycleKey);
      issues.push({
        severity: "warning",
        docId: cycle[0],
        rule: "circular-reference",
        message: `Circular reference detected: ${cycle.join(" -> ")} -> ${docId}`,
      });
    };

    const walk = (walkParams: { docId: string; path: string[] }): void => {
      const { docId, path } = walkParams;
      visited.add(docId);
      inStack.add(docId);

      for (const ref of related(docId)) {
        if (refs.has(ref)) {
          dfs({ docId: ref, path: [...path, docId] });
        }
      }

      inStack.delete(docId);
    };

    const dfs = (dfsParams: { docId: string; path: string[] }): void => {
      const { docId, path } = dfsParams;
      if (inStack.has(docId)) {
        reportCycle({ docId, path });
        return;
      }
      if (visited.has(docId)) return;

      walk({ docId, path });
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
    if (eitherIsEmpty({ str1, str2 })) return 0;
    if (str1 === str2) return 1;

    return jaccardOverlap({
      words1: significantWords(str1),
      words2: significantWords(str2),
    });
  }
}
