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
import { frontmatterErrors, parseFrontmatter, stripFrontmatter } from "../utils/frontmatter-parser.js";
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
 * How long a verbatim run has to be before it is a copy rather than a
 * coincidence.
 *
 * Eight lines is past what two documents share by writing about the same thing:
 * a shared heading, a two-line preamble and a code fence of the same command
 * all fall under it, and a repeated procedure does not.
 */
const DEFAULT_MIN_DUPLICATE_LINES = 8;

/**
 * An environment override, or undefined when there is nothing usable there.
 *
 * An unreadable or out-of-range value falls back to the default rather than
 * throwing, as `configuredAttempts` does: a typo in an environment variable
 * should not stop the server from starting. The three settings below differ only
 * in what counts as in range, so that is the one thing each of them passes in.
 */
function envOverride(params: {
  raw: string | undefined;
  isInRange: (value: number) => boolean;
}): number | undefined {
  const { raw, isInRange } = params;
  if (raw === undefined) return undefined;

  const parsed = Number(raw);
  if (!isInRange(parsed)) return undefined;
  return parsed;
}

function isLineCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

/** A ratio: 0 would make every pair of documents similar to every other. */
function isRatio(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1;
}

/** One shared line is a coincidence, so a run has to be at least two. */
function isRunLength(value: number): boolean {
  return Number.isInteger(value) && value >= 2;
}

/**
 * `IIMCP_LINT_MAX_LINES`, the body-line count a document may reach before
 * `document-too-large` is reported.
 */
export function configuredMaxLines(): number {
  return (
    envOverride({ raw: process.env.IIMCP_LINT_MAX_LINES, isInRange: isLineCount }) ??
    DEFAULT_MAX_LINES
  );
}

/**
 * `IIMCP_LINT_SIMILARITY`, the overlap above which two documents are reported
 * as similar.
 */
export function configuredSimilarityThreshold(): number {
  return (
    envOverride({ raw: process.env.IIMCP_LINT_SIMILARITY, isInRange: isRatio }) ??
    DEFAULT_SIMILARITY_THRESHOLD
  );
}

/**
 * `IIMCP_LINT_MIN_DUPLICATE_LINES`, the shortest run of identical lines that is
 * reported as copied between two documents.
 */
export function configuredMinDuplicateLines(): number {
  return (
    envOverride({
      raw: process.env.IIMCP_LINT_MIN_DUPLICATE_LINES,
      isInRange: isRunLength,
    }) ?? DEFAULT_MIN_DUPLICATE_LINES
  );
}

/**
 * The lines of a body, as they are compared.
 *
 * Trimmed and emptied of blanks, because indentation and spacing are not what
 * makes two passages the same passage, and a document reflowed by an editor
 * would otherwise stop matching the one it was copied from.
 */
export function comparableBody(content: string): string[] {
  return comparableLines(stripFrontmatter(content));
}

function comparableLines(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * The longest run of lines two documents share.
 *
 * A plain longest-common-substring over lines. The corpus is a few hundred
 * documents of a few hundred lines, so the quadratic table is measured in
 * milliseconds; anything cleverer would be harder to read than the rule is
 * worth.
 */
export function longestSharedRun(params: { a: string[]; b: string[] }): { lines: number; at: number } {
  const { a, b } = params;
  let best = 0;
  let endInA = 0;

  // One row at a time: the table is only ever read one row back.
  let previous = Array.from<number>({ length: b.length + 1 }).fill(0);

  for (let i = 1; i <= a.length; i++) {
    const current = runsEndingAt({ previous, a, b, i });
    const longest = current.reduce((max, run) => (run > max ? run : max), 0);
    if (longest > best) {
      best = longest;
      endInA = i;
    }
    previous = current;
  }

  return { lines: best, at: endInA - best + 1 };
}

/**
 * How long a shared run ending at `a[i - 1]` is, for every position in `b`.
 *
 * Split from the search above so the recurrence stands on its own: this is the
 * table, and the caller is only about which of its rows held the longest run.
 */
function runsEndingAt(params: { previous: number[]; a: string[]; b: string[]; i: number }): number[] {
  const { previous, a, b, i } = params;
  const current = Array.from<number>({ length: b.length + 1 }).fill(0);

  for (let j = 1; j <= b.length; j++) {
    if (a[i - 1] !== b[j - 1]) continue;
    current[j] = previous[j - 1] + 1;
  }

  return current;
}

/**
 * The headings of a markdown body, skipping fenced code.
 *
 * A `# comment` inside a shell block is not a section, and a document that
 * shows two similar commands would otherwise report a duplicate heading for
 * every example it contains.
 */
export function headingsOf(body: string): Heading[] {
  const headings: Heading[] = [];

  for (const line of outsideFences(body.split("\n"))) {
    const heading = headingOf(line);
    if (heading !== null) headings.push(heading);
  }

  return headings;
}

interface Heading {
  level: number;
  text: string;
}

/**
 * The lines that are neither inside a fenced block nor a fence themselves.
 *
 * A pass of its own, because whether a line is inside a fence depends on every
 * line before it while whether it is a heading depends on the line alone. Doing
 * both in one loop meant the fence state machine was only ever readable together
 * with the heading regex.
 */
function outsideFences(lines: string[]): string[] {
  const kept: string[] = [];
  let fence: string | null = null;

  for (const line of lines) {
    const marker = fenceMarkerOf(line);
    if (isContentLine({ fence, marker })) kept.push(line);
    fence = fenceAfter({ fence, marker });
  }

  return kept;
}

/** Judged before the state moves on, so a fence line is never content itself. */
function isContentLine(params: { fence: string | null; marker: string | null }): boolean {
  return params.fence === null && params.marker === null;
}

/** The character a fence line is drawn with, or null when the line is not one. */
function fenceMarkerOf(line: string): string | null {
  const match = /^\s*(`{3,}|~{3,})/.exec(line);
  if (match === null) return null;
  return match[1][0];
}

function fenceAfter(params: { fence: string | null; marker: string | null }): string | null {
  const { fence, marker } = params;
  if (marker === null) return fence;
  return fenceToggled({ fence, marker });
}

/**
 * Null means no fence is open; otherwise the state is the character the open
 * fence was drawn with, because a fence closes only on its own kind -- a ```
 * inside a ~~~ block is content rather than the end of it.
 */
function fenceToggled(params: { fence: string | null; marker: string }): string | null {
  const { fence, marker } = params;
  if (fence === null) return marker;
  if (fence === marker) return null;
  return fence;
}

function headingOf(line: string): Heading | null {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if (match === null) return null;
  return { level: match[1].length, text: match[2].trim() };
}

/**
 * Values that arrive where a reason should be, and are not one.
 *
 * `null` removes the exemption, and a client that renders tool arguments as
 * strings cannot send it -- what reaches the server is the four characters
 * `null`, which was accepted and stored as the reason. So the call the
 * `stale-size-exemption` finding recommends did nothing, and the finding came
 * back, saying the same thing.
 *
 * Kept to the two that come from serialising an absent value. "none" and "n/a"
 * are things somebody might actually mean, however unhelpfully, and guessing at
 * those would be deciding what a reason is allowed to say.
 */
const PLACEHOLDER_REASONS = new Set(["null", "undefined"]);

/**
 * Whether a `sizeExemption` value says anything.
 *
 * Shared by the write path, which refuses these before they are stored, and by
 * `lint`, which reports the ones already in a corpus -- 2.0.1 stored them for
 * anyone whose client stringifies, and a document whose reason reads "null" is
 * one the next reader cannot make sense of either way.
 */
export function isReasonGiven(value: string | undefined): boolean {
  if (value === undefined) return false;
  const trimmed = value.trim();
  return trimmed !== "" && !PLACEHOLDER_REASONS.has(trimmed.toLowerCase());
}

/**
 * Every document-local rule, run over one document's raw file content.
 *
 * `add`, `update` and `lint` all call this, which is the point: a rule added
 * here starts reporting at write time and in the corpus report together,
 * rather than in whichever one the author happened to edit.
 */
export function checkDocument(params: {
  docId: string;
  content: string;
  /**
   * The id to write into an example call, when that differs from the one to
   * print.
   *
   * `lint` labels a draft `<id> (draft)`, because the stored id names a path
   * rather than anything an action takes. Once these messages began naming the
   * call that answers them, that label went into the call too, and every
   * finding on a draft offered `id: "big (draft)"` -- an id no action accepts.
   * The label and the argument are different things and are now passed
   * separately.
   */
  callId?: string;
}): LintIssue[] {
  const { docId, content, callId = params.docId } = params;
  const frontmatter = parseFrontmatter(content);
  const body = stripFrontmatter(content);

  // A block that did not parse has no metadata as far as everything below is
  // concerned, so reporting those rules as well would name three consequences and
  // no cause -- and the fix for all of them is the same one line of YAML.
  const unreadable = checkFrontmatterReadable({ docId, callId, content });
  if (unreadable.length > 0) {
    return [...unreadable, ...checkDuplicateHeadings({ docId, body })];
  }

  return [
    ...checkMissingMetadata({ docId, frontmatter }),
    ...checkDocumentSize({ docId, callId, body, frontmatter }),
    ...checkDuplicateHeadings({ docId, body }),
  ];
}

/**
 * The frontmatter could not be read, which is a different fact from having none.
 *
 * Reported as an error rather than a warning because everything downstream is
 * wrong while it holds: the document's own metadata reads as absent, and a
 * `relatedDocs` entry that is plainly in the file is invisible, so the document it
 * names is reported as orphaned. One unquoted colon produced four findings, three
 * of which named the wrong cause and one of which was simply false.
 */
function checkFrontmatterReadable(params: {
  docId: string;
  callId: string;
  content: string;
}): LintIssue[] {
  const { docId, callId, content } = params;
  const errors = frontmatterErrors(content);
  if (errors.length === 0) return [];

  return [{
    severity: "error",
    docId,
    rule: "frontmatter-unreadable",
    message:
      `The frontmatter is not valid YAML, so none of this document's metadata is ` +
      `being read and any \`relatedDocs\` in it are invisible: ${errors[0]}. ` +
      "A value containing `: ` has to be quoted, which is the usual cause and is " +
      "what writing the block by hand gets wrong. " +
      `\`instruction(action: "update", id: "${callId}", description: "<text>")\` ` +
      "quotes it correctly, but the block has to parse before a write can keep the " +
      "rest of it -- repair the file first.",
  }];
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
  callId: string;
  body: string;
  frontmatter: DocumentFrontmatter;
}): LintIssue[] {
  const { docId, callId, body, frontmatter } = params;

  // The body only. Counting the frontmatter meant that describing a document
  // well spent its size budget: a fifth `whenToUse` entry is a line against the
  // limit, so the rule rewarded thin metadata and eventually warned about
  // documents whose prose was well within it.
  const maxLines = configuredMaxLines();
  const lineCount = body.split("\n").length;
  const tooLarge = lineCount > maxLines;
  const exemption = frontmatter.sizeExemption;
  const hasReason = isReasonGiven(exemption);

  return [
    ...exemptionWithoutReason({ docId, callId, exemption, hasReason }),
    ...documentTooLarge({ docId, callId, lineCount, maxLines, tooLarge, hasReason }),
    ...staleExemption({ docId, callId, lineCount, tooLarge, hasReason }),
  ];
}

function exemptionWithoutReason(params: {
  docId: string;
  callId: string;
  exemption: string | undefined;
  hasReason: boolean;
}): LintIssue[] {
  const { docId, callId, exemption, hasReason } = params;
  if (exemption === undefined || hasReason) return [];

  return [
    {
      severity: "warning",
      docId,
      rule: "size-exemption-without-reason",
      message:
        `\`sizeExemption\` is set to ${quotedReason(exemption)}, which says nothing about why the document stays whole. ` +
        "Without a reason it is a mute button, and the next reader cannot tell " +
        "a decision from an unaddressed warning: " +
        `\`instruction(action: "update", id: "${callId}", sizeExemption: "<why>")\`.`,
    },
  ];
}

/** `set to ""` reads as a bug in the message rather than as an empty reason. */
function quotedReason(exemption: string | undefined): string {
  if (exemption === undefined || exemption.trim() === "") return "nothing";
  return `"${exemption.trim()}"`;
}

function documentTooLarge(params: {
  docId: string;
  callId: string;
  lineCount: number;
  maxLines: number;
  tooLarge: boolean;
  hasReason: boolean;
}): LintIssue[] {
  const { docId, callId, lineCount, maxLines, tooLarge, hasReason } = params;
  if (!tooLarge || hasReason) return [];

  return [
    {
      severity: "warning",
      docId,
      rule: "document-too-large",
      message:
        `Document body has ${lineCount} lines (max recommended: ${maxLines}). ` +
        "Consider splitting, or say why it stays whole: " +
        `\`instruction(action: "update", id: "${callId}", sizeExemption: "<why>")\`.`,
    },
  ];
}

/**
 * Nothing else would ever mention the exemption again, and a stale one is how
 * the next long document gets waved through.
 */
function staleExemption(params: {
  docId: string;
  callId: string;
  lineCount: number;
  tooLarge: boolean;
  hasReason: boolean;
}): LintIssue[] {
  const { docId, callId, lineCount, tooLarge, hasReason } = params;
  if (tooLarge || !hasReason) return [];

  return [
    {
      severity: "info",
      docId,
      rule: "stale-size-exemption",
      message:
        `Document body is ${lineCount} lines, within the limit, but still carries ` +
        "`sizeExemption`, and an exemption outlives the reason for it: " +
        `\`instruction(action: "update", id: "${callId}", sizeExemption: null)\`.`,
    },
  ];
}

/**
 * The chain of headings a heading sits under, as a comparable key.
 *
 * `## Feature A` / `### Endpoint` and `## Feature B` / `### Endpoint` differ
 * here, while two `### Endpoint` under one `## Feature A` do not -- which is the
 * whole distinction the rule below needs.
 *
 * The full chain rather than the nearest parent, so it keeps working below the
 * third level: two `#### Request` under different `### Endpoint`s of the same
 * `## Feature` are as intended as the endpoints are.
 *
 * A heading deeper than its predecessor by more than one level leaves a gap in
 * the chain; the shallower entries stay as they are, which is what an author
 * skipping `###` to reach `####` means by it.
 */
function ancestryOf(headings: Heading[]): string[] {
  const keys: string[] = [];
  const chain: string[] = [];

  for (const heading of headings) {
    chain.length = heading.level - 1;
    keys.push(chain.map((text) => text ?? "").join(" > "));
    chain[heading.level - 1] = heading.text.toLowerCase();
  }

  return keys;
}

/**
 * The same heading twice under the same parent.
 *
 * A more specific signal than length, and a different one: it is what appending
 * to a document looks like. A `## Related` in the middle and another at the end
 * means a section was added after the one that was already there rather than
 * into it -- and in the case this came from, the appended part turned out to be
 * a separable topic.
 *
 * The parent is load-bearing, and leaving it out is what made this rule unusable
 * on the documents it was most likely to be run against. A specification that
 * writes `### Endpoint` / `### Request body` once per feature repeats those by
 * design, and counting by text and level alone reported every one of them: one
 * corpus of 47 documents produced eleven such findings, and the one document
 * that really had been appended to -- `## Security` twice at the top level --
 * was nearly missed among them. Comparing the ancestry keeps that one and drops
 * the other eleven, without asking anybody to write a reason for a structure
 * that was never wrong.
 *
 * Reported whatever the document's size says, including when it is exempt:
 * being deliberately long says nothing about the structure being sound.
 */
function checkDuplicateHeadings(params: { docId: string; body: string }): LintIssue[] {
  const { docId, body } = params;
  const issues: LintIssue[] = [];

  for (const counted of countedHeadings(body).values()) {
    if (counted.times < 2) continue;
    issues.push(duplicateHeadingIssue({ docId, counted }));
  }

  return issues;
}

interface CountedHeading extends Heading {
  under: string;
  times: number;
}

function countedHeadings(body: string): Map<string, CountedHeading> {
  const headings = headingsOf(body);
  const ancestry = ancestryOf(headings);

  const counts = new Map<string, CountedHeading>();
  for (const [index, heading] of headings.entries()) {
    // Level as well as text, so `# Setup` with a `## Setup` under it is nesting
    // rather than a section that came back; and ancestry, so the same subsection
    // under two different sections is the shape of a reference table.
    const under = ancestry[index];
    const key = `${under}\u0000${heading.level}:${heading.text.toLowerCase()}`;
    counts.set(key, { ...heading, under, times: timesSeen({ counts, key }) + 1 });
  }

  return counts;
}

/** A key we have not seen counts as zero, so the caller adds one either way. */
function timesSeen(params: { counts: Map<string, CountedHeading>; key: string }): number {
  return params.counts.get(params.key)?.times ?? 0;
}

function duplicateHeadingIssue(params: { docId: string; counted: CountedHeading }): LintIssue {
  const { docId, counted } = params;
  const { level, text, under, times } = counted;

  return {
    severity: "warning",
    docId,
    rule: "duplicate-heading",
    message:
      `"${"#".repeat(level)} ${text}" appears ${times} times under ` +
      `${describeParent(under)}. ` +
      "A section that comes back under the same parent usually means something " +
      "was appended to the end of the document rather than into it; the later " +
      "part is often a topic of its own.",
  };
}

/** The top level has no heading to quote. */
function describeParent(under: string): string {
  if (under === "") return "the top level";
  return `"${under}"`;
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
