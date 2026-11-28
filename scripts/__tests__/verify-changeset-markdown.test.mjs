import { describe, it, expect } from "vitest";
import {
  changesetBody,
  checkChangeset,
  findEscapedBackticks,
  findUnquotedSeparators,
  splitCodeSpans,
} from "../verify-changeset-markdown.mjs";

/**
 * The sentence that shipped, as it was written.
 *
 * Kept verbatim rather than reduced to a minimal case: the minimal case is one
 * line, and what made this hard to see was that it was one sentence inside six
 * paragraphs of prose that all looked fine.
 */
const BROKEN =
  "The first two read `relatedDocs` and the prose alike, since the list that " +
  "started this was written as `See \\`workflow__dry-principle\\`` in the body. " +
  "Only ids carrying the `__` separator are searched for.";

/** The same sentence after #86, with the nesting removed. */
const FIXED =
  "The first two read `relatedDocs` and the prose alike, since the list that " +
  "started this was written in the body as a `See` line naming " +
  "`workflow__dry-principle`. Only ids carrying the `__` separator are searched for.";

describe("changesetBody", () => {
  it("drops the block naming the packages and their bump", () => {
    const content = '---\n"mcp-interactive-instruction": patch\n---\n\nThe text.\n';
    expect(changesetBody(content)).toBe("\nThe text.\n");
  });

  it.each([
    ["no frontmatter at all", "Just text.\n"],
    ["an unterminated block", '---\n"pkg": patch\n'],
  ])("returns the content unchanged given %s", (_name, content) => {
    expect(changesetBody(content)).toBe(content);
  });
});

describe("splitCodeSpans", () => {
  it("pairs a run of backticks with the next run of the same length", () => {
    const segments = splitCodeSpans("a `one` b ``two`` c");
    const code = segments.filter((s) => s.code).map((s) => s.text);

    expect(code).toEqual(["`one`", "``two``"]);
  });

  /**
   * The parser's rule, not the author's expectation. A backslash is an ordinary
   * character in a code span, so the span ends at the backticks before it --
   * which is why `workflow__dry-principle` was in prose.
   */
  it("ends a span at the backticks, backslash or no backslash", () => {
    const segments = splitCodeSpans("x `a \\`b\\`` y");
    const prose = segments.filter((s) => !s.code).map((s) => s.text).join("");

    expect(prose).toContain("b\\");
  });

  it("reports an offset that indexes back into the original text", () => {
    const text = "aaa `bbb` ccc";
    const span = splitCodeSpans(text).find((s) => s.code);

    expect(text.slice(span.at, span.at + span.text.length)).toBe("`bbb`");
  });

  /**
   * The prose before the first span is a segment too.
   *
   * It was not, in a draft: the loop pushed the code and the trailing prose and
   * lost everything ahead of the first backtick. Nothing noticed, because every
   * other test here happens to put its separator after a span or in a body with
   * no span at all.
   */
  it("keeps the prose that comes before a span", () => {
    const found = findUnquotedSeparators({ name: "x", body: "workflow__a, then `code`." });

    expect(found).toHaveLength(1);
  });

  /**
   * A span closes on a run of its own length, which is what makes `` `__` `` --
   * the correct way to put backticks around an id -- a single span rather than
   * two spans with the id loose between them.
   */
  it("closes a span only on a run of the same length", () => {
    const body = "`` `__` `` is how to quote it.";
    const segments = splitCodeSpans(body);

    expect(segments.filter((s) => s.code).map((s) => s.text)).toEqual(["`` `__` ``"]);
    expect(checkChangeset({ name: "x", body })).toEqual([]);
  });

  it("leaves an unclosed run in prose rather than swallowing the rest", () => {
    const segments = splitCodeSpans("text ` and more __here__");

    expect(segments.every((s) => !s.code)).toBe(true);
    expect(findUnquotedSeparators({ name: "x", body: "text ` and more __here__" })).toHaveLength(2);
  });
});

describe("the two rules, on the changeset that shipped", () => {
  it("reports the escaped backtick", () => {
    const found = findEscapedBackticks({ name: "hub", body: BROKEN });

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("escaped-backtick-in-code-span");
    expect(found[0].says).toContain("cannot be escaped");
  });

  /**
   * Two, not one. The broken span leaves the id's separator in prose, and it
   * also leaves the `` `__` `` that follows it outside any span -- so the
   * sentence explaining the separator was republished as `**` as well.
   */
  it("reports both separators the broken span left in prose", () => {
    const found = findUnquotedSeparators({ name: "hub", body: BROKEN });

    expect(found).toHaveLength(2);
    expect(found[0].excerpt).toContain("workflow");
  });

  it("says nothing about the sentence once the nesting is gone", () => {
    expect(checkChangeset({ name: "hub", body: FIXED })).toEqual([]);
  });
});

describe("what it does not report", () => {
  /**
   * The findings the first draft produced, each of which was correct about the
   * text changing and wrong about it mattering. A check that reports a padded
   * table is a check people learn to skip.
   */
  it.each([
    ["a separator inside a code span", "Only ids carrying the `__` separator."],
    ["an id inside a code span", "See `workflow__dry-principle` for it."],
    ["a table prettier will pad", "| a | b |\n| --- | --- |\n| c | d |\n"],
    ["emphasis prettier will restyle", "supplied *after* the human handed over."],
    ["a fenced block containing separators", "```\nworkflow__a\nworkflow__b\n```\n"],
    ["prose with no separator at all", "An ordinary sentence about policy."],
    ["a single underscore in prose", "The field is called some_field here."],
  ])("says nothing about %s", (_name, body) => {
    expect(checkChangeset({ name: "x", body })).toEqual([]);
  });
});

describe("checkChangeset", () => {
  it("reports an id written in prose, which is the general form of the bug", () => {
    const found = checkChangeset({ name: "x", body: "Read workflow__dry-principle first." });

    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("separator-outside-code-span");
    expect(found[0].says).toContain("published as `**`");
  });

  it("reports every occurrence, not just the first", () => {
    const found = checkChangeset({ name: "x", body: "both workflow__a and policy__b" });

    expect(found).toHaveLength(2);
  });

  /**
   * The offset is into the file, not into the segment it was found in.
   *
   * A body with no code span in front of the finding cannot tell the two apart,
   * because the segment starts at zero -- which is what the first version of
   * this test did, so it passed with the offsets relative and useless.
   */
  it.each([
    ["with no span before it", "A sentence, then workflow__dry-principle here."],
    ["after a code span", "First `relatedDocs`, then workflow__dry-principle here."],
    ["after two code spans", "`a` and `b`, then workflow__dry-principle here."],
  ])("carries an offset into the file, %s", (_name, body) => {
    const found = checkChangeset({ name: "x", body });

    expect(found).toHaveLength(1);
    expect(body.slice(found[0].at, found[0].at + 2)).toBe("__");
    expect(found[0].excerpt).toContain("workflow");
  });

  it("carries an offset into the file for an escaped backtick after a span", () => {
    const body = "Quoting `relatedDocs`, then `See \\`x\\`` at the end.";
    const found = findEscapedBackticks({ name: "x", body });

    expect(found.length).toBeGreaterThan(0);
    expect(body.slice(found[0].at, found[0].at + 2)).toBe("\\`");
  });
});
