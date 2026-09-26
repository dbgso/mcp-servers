/**
 * The checks a single document can answer on its own.
 *
 * Split out of `lint` because the answer arrives too late there. A document
 * that is 40 lines over the limit is over it the moment it is written, and the
 * author is the one person who still remembers why -- but `lint` is a separate
 * call nobody makes until something else prompts it, by which time the
 * document has been approved and the reason for its shape is gone. So `add`
 * and `update` report these the moment they write, and `lint` runs the same
 * functions over the whole corpus.
 *
 * Only the document-local rules live here. Orphans, similarity and circular
 * references are properties of the corpus, not of a file, and a single write
 * cannot decide them.
 */

import type { DocumentFrontmatter } from "../types/index.js";
import { parseFrontmatter, stripFrontmatter } from "../utils/frontmatter-parser.js";
import { isDescriptionMissing, isWhenToUseMissing } from "./metadata-completeness.js";

export interface LintIssue {
  severity: "error" | "warning" | "info";
  docId: string;
  rule: string;
  message: string;
}

/**
 * Defaults, and why they are only defaults.
 *
 * 150 lines and 60% overlap are what this repository's corpus wanted; another
 * corpus will want something else. A team whose documents are mostly runbooks
 * reads a warning at 150 lines as noise, and one writing short task cards would
 * rather be told at 60. Neither is wrong, and neither is a reason to argue
 * about the constant -- so it is an environment variable.
 */
const DEFAULT_MAX_LINES = 150;
const DEFAULT_SIMILARITY_THRESHOLD = 0.6;

/**
 * `IIMCP_LINT_MAX_LINES`, the body-line count a document may reach before
 * `document-too-large` is reported.
 *
 * An unreadable or out-of-range value falls back to the default rather than
 * throwing, as `configuredAttempts` does: a typo in an environment variable
 * should not stop the server from starting.
 */
export function configuredMaxLines(): number {
  const raw = process.env.IIMCP_LINT_MAX_LINES;
  if (raw === undefined) return DEFAULT_MAX_LINES;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_LINES;
  return parsed;
}

/**
 * `IIMCP_LINT_SIMILARITY`, the overlap above which two documents are reported
 * as similar. A ratio, so only values in (0, 1] are meaningful -- 0 would make
 * every pair of documents similar to every other.
 */
export function configuredSimilarityThreshold(): number {
  const raw = process.env.IIMCP_LINT_SIMILARITY;
  if (raw === undefined) return DEFAULT_SIMILARITY_THRESHOLD;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return DEFAULT_SIMILARITY_THRESHOLD;
  }
  return parsed;
}

/**
 * The headings of a markdown body, skipping fenced code.
 *
 * A `# comment` inside a shell block is not a section, and a document that
 * shows two similar commands would otherwise report a duplicate heading for
 * every example it contains.
 */
export function headingsOf(body: string): { level: number; text: string }[] {
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

/**
 * Every document-local rule, run over one document's raw file content.
 *
 * `add`, `update` and `lint` all call this, which is the point: a rule added
 * here starts reporting at write time and in the corpus report together,
 * rather than in whichever one the author happened to edit.
 */
export function checkDocument(params: { docId: string; content: string }): LintIssue[] {
  const { docId, content } = params;
  const frontmatter = parseFrontmatter(content);
  const body = stripFrontmatter(content);

  return [
    ...checkMissingMetadata({ docId, frontmatter }),
    ...checkDocumentSize({ docId, body, frontmatter }),
    ...checkDuplicateHeadings({ docId, body }),
  ];
}

function checkMissingMetadata(params: {
  docId: string;
  frontmatter: DocumentFrontmatter;
}): LintIssue[] {
  const { docId, frontmatter } = params;
  const issues: LintIssue[] = [];

  if (isDescriptionMissing(frontmatter)) {
    issues.push({
      severity: "error",
      docId,
      rule: "missing-description",
      message: "Missing description in frontmatter",
    });
  }

  if (isWhenToUseMissing(frontmatter)) {
    issues.push({
      severity: "warning",
      docId,
      rule: "missing-when-to-use",
      message: "Missing whenToUse in frontmatter",
    });
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
function checkDocumentSize(params: {
  docId: string;
  body: string;
  frontmatter: DocumentFrontmatter;
}): LintIssue[] {
  const { docId, body, frontmatter } = params;
  const issues: LintIssue[] = [];

  // The body only. Counting the frontmatter meant that describing a document
  // well spent its size budget: a fifth `whenToUse` entry is a line against the
  // limit, so the rule rewarded thin metadata and eventually warned about
  // documents whose prose was well within it.
  const maxLines = configuredMaxLines();
  const lineCount = body.split("\n").length;
  const tooLarge = lineCount > maxLines;
  const exemption = frontmatter.sizeExemption;
  const hasReason = exemption !== undefined && exemption.trim() !== "";

  if (exemption !== undefined && !hasReason) {
    issues.push({
      severity: "warning",
      docId,
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
      docId,
      rule: "document-too-large",
      message:
        `Document body has ${lineCount} lines (max recommended: ${maxLines}). ` +
        "Consider splitting, or set `sizeExemption` to say why it stays whole.",
    });
  }

  if (!tooLarge && hasReason) {
    // Nothing else would ever mention it again, and a stale exemption is how
    // the next long document gets waved through.
    issues.push({
      severity: "info",
      docId,
      rule: "stale-size-exemption",
      message:
        `Document body is ${lineCount} lines, within the limit, but still carries ` +
        "`sizeExemption`. Remove it, or the exemption outlives the reason for it.",
    });
  }

  return issues;
}

/**
 * The same heading twice in one document.
 *
 * A more specific signal than length, and a different one: it is what
 * appending to a document looks like. A `## Related` in the middle and another
 * at the end means a section was added after the one that was already there
 * rather than into it -- and in the case this came from, the appended part
 * turned out to be a separable topic.
 *
 * Reported whatever the document's size says, including when it is exempt:
 * being deliberately long says nothing about the structure being sound.
 */
function checkDuplicateHeadings(params: { docId: string; body: string }): LintIssue[] {
  const { docId, body } = params;
  const issues: LintIssue[] = [];

  const counts = new Map<string, { level: number; text: string; times: number }>();
  for (const heading of headingsOf(body)) {
    // Keyed by level as well as text: `# Setup` with a `## Setup` under it is
    // nesting, not a section that came back.
    const key = `${heading.level}:${heading.text.toLowerCase()}`;
    const seen = counts.get(key);
    counts.set(key, { ...heading, times: (seen?.times ?? 0) + 1 });
  }

  for (const { level, text, times } of counts.values()) {
    if (times < 2) continue;
    issues.push({
      severity: "warning",
      docId,
      rule: "duplicate-heading",
      message:
        `"${"#".repeat(level)} ${text}" appears ${times} times. ` +
        "A section that comes back usually means something was appended to the " +
        "end of the document rather than into it; the later part is often a " +
        "topic of its own.",
    });
  }

  return issues;
}

export function severityIcon(severity: LintIssue["severity"]): string {
  if (severity === "error") return "x";
  if (severity === "warning") return "!";
  return "i";
}

/**
 * What a write says back about what it just wrote.
 *
 * Appended to a successful response, never in place of one: the document is
 * saved either way. Refusing the write would make the limit a gate, and a gate
 * on document length is exactly the thing the `sizeExemption` escape hatch
 * exists to avoid -- the author would drop the paragraph rather than argue
 * with the tool.
 */
export function formatWriteLint(issues: LintIssue[]): string {
  if (issues.length === 0) return "";

  const lines = ["", "", `## Lint (${issues.length})`, ""];
  for (const issue of issues) {
    lines.push(`- [${severityIcon(issue.severity)}] **${issue.rule}**: ${issue.message}`);
  }
  lines.push("", "The document was saved. Fix these with `update`, or leave them.");

  return lines.join("\n");
}
