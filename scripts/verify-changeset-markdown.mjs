#!/usr/bin/env node
/**
 * Refuses a changeset whose text will not say the same thing once it is written
 * to a CHANGELOG.
 *
 * `changeset version` copies a changeset's body into CHANGELOG.md and runs
 * prettier over the file. Where the markdown is ambiguous, prettier resolves the
 * ambiguity, and the resolution is what is published to npm. Nobody reads a
 * generated CHANGELOG before it ships: the author sees their changeset and never
 * the file it turns into.
 *
 * The case this was written for:
 *
 *     `See \`workflow__dry-principle\``
 *
 * Markdown has no escape for a backtick inside a code span. The span closed at
 * the backslash, which left `workflow__dry-principle` sitting in prose, and
 * prettier read the `__` pairs as strong emphasis. The published entry said
 * `workflow**dry-principle` and had lost the spaces around three code spans.
 *
 * Two rules, which is what the first draft of this script got wrong. It compared
 * the text with prettier's output and reported any difference, which fires on a
 * table whose cells prettier padded and on `*after*` becoming `_after_` -- two
 * findings whose only correct response is to ignore them, which is the kind that
 * teaches people to ignore the rest. These rules are about what the markdown
 * means, so they do not fire on how it is laid out.
 *
 * Usage: node scripts/verify-changeset-markdown.mjs   (from the repository root)
 */
import { readFile, glob } from "node:fs/promises";

/**
 * A changeset's text split into what is inside a code span and what is not.
 *
 * Scanned the way CommonMark defines it: a run of N backticks opens a span, and
 * the next run of exactly N closes it. A backslash does nothing here -- that is
 * the whole of the bug this exists for, so the scan has to be wrong in the same
 * way the parser is, not in the way the author expected.
 */
export function splitCodeSpans(text) {
  const segments = [];
  const runs = [...text.matchAll(/`+/g)];

  let at = 0;
  let open = null;

  for (const run of runs) {
    if (open === null) {
      open = run;
      continue;
    }
    if (run[0].length !== open[0].length) continue;

    segments.push({ code: false, text: text.slice(at, open.index), at });
    segments.push({ code: true, text: text.slice(open.index, run.index + run[0].length), at: open.index });
    at = run.index + run[0].length;
    open = null;
  }

  segments.push({ code: false, text: text.slice(at), at });
  return segments;
}

/** The body, without the `---` block naming the packages and their bump. */
export function changesetBody(content) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(content);
  return match === null ? content : match[1];
}

/** Enough of the line around an offset to recognise which sentence it is. */
function excerpt(params) {
  const { text, at } = params;
  return text.slice(Math.max(0, at - 50), at + 50).replace(/\s+/g, " ");
}

/**
 * A `__` that prettier will read as emphasis.
 *
 * Every id in this repository's corpus carries the separator, so any id written
 * outside a code span is republished as `**`, which is a different id. Fenced
 * blocks are left alone: they are code, and `splitCodeSpans` treats the fence as
 * a long backtick run, so their contents land inside a span.
 */
export function findUnquotedSeparators(params) {
  const { name, body } = params;
  const findings = [];

  for (const segment of splitCodeSpans(body)) {
    if (segment.code) continue;
    for (const hit of segment.text.matchAll(/__/g)) {
      findings.push({
        name,
        rule: "separator-outside-code-span",
        at: segment.at + hit.index,
        excerpt: excerpt({ text: body, at: segment.at + hit.index }),
        says: "`__` here is read as emphasis and published as `**`. Put the id in a code span.",
      });
    }
  }

  return findings;
}

/**
 * A backslash before a backtick, inside a code span.
 *
 * It escapes nothing. The span has already ended at the run of backticks before
 * it, so whatever the author meant to quote is in prose from that point on.
 */
export function findEscapedBackticks(params) {
  const { name, body } = params;
  const findings = [];

  for (const segment of splitCodeSpans(body)) {
    if (!segment.code) continue;
    for (const hit of segment.text.matchAll(/\\`/g)) {
      findings.push({
        name,
        rule: "escaped-backtick-in-code-span",
        at: segment.at + hit.index,
        excerpt: excerpt({ text: body, at: segment.at + hit.index }),
        says: "A backtick cannot be escaped inside a code span. Rewrite the sentence without the nesting.",
      });
    }
  }

  return findings;
}

export function checkChangeset(params) {
  return [...findEscapedBackticks(params), ...findUnquotedSeparators(params)];
}

function report(findings) {
  const lines = [`${findings.length} problem(s) in the changesets:`, ""];

  for (const finding of findings) {
    lines.push(`  ${finding.name} (${finding.rule}), at character ${finding.at}:`);
    lines.push(`    ...${finding.excerpt}...`);
    lines.push(`    ${finding.says}`);
    lines.push("");
  }

  lines.push(
    "A changeset is published as part of the package's CHANGELOG.md, and nobody",
    "reads that file before it ships.",
  );

  return lines.join("\n");
}

async function main() {
  const findings = [];

  for await (const file of glob(".changeset/*.md")) {
    if (file.endsWith("README.md")) continue;
    findings.push(...checkChangeset({ name: file, body: changesetBody(await readFile(file, "utf-8")) }));
  }

  if (findings.length === 0) {
    console.log("Every changeset says what it will publish.");
    return;
  }

  console.error(report(findings));
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
