/**
 * A write must touch what it was asked to touch and nothing else.
 *
 * The previous implementation broke that three ways at once, and none of the
 * existing tests noticed, because they were all written with documents made of
 * the seven keys the parser knew. Everything it destroyed -- a key it had never
 * heard of, a comment, the order the author chose -- was absent from the
 * fixtures, so the suite was green while `link_add` was quietly deleting an
 * `owner:` line.
 *
 * These are the cases that were missing. They are written as a property --
 * parse, write back the same values, get the same file -- so the next key
 * someone adds is covered without anyone remembering to cover it.
 */

import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  updateFrontmatter,
  stripFrontmatter,
} from "../utils/frontmatter-parser.js";

/** Write a document's own metadata back onto it. Nothing should change. */
function rewriteUnchanged(content: string): string {
  return updateFrontmatter({ content, frontmatter: parseFrontmatter(content) });
}

function doc(frontmatter: string, body = "# Title\n\nBody"): string {
  return `---\n${frontmatter}\n---\n\n${body}`;
}

describe("rewriting a document without changing anything", () => {
  it.each([
    [
      "a key the parser has never heard of",
      "description: A host document\nowner: platform-team",
    ],
    [
      "several unknown keys",
      "description: A doc\nowner: platform-team\nticket: PLAT-4821\nreviewed: 2026-01-14",
    ],
    [
      "an unknown key holding a nested list",
      "description: A doc\ntags:\n  - critical\n  - reviewed-2026Q1",
    ],
    [
      "an unknown key holding a nested map",
      "description: A doc\ncontact:\n  team: platform\n  slack: '#platform'",
    ],
    [
      "a comment above the metadata",
      "# Owned by the platform team; do not retire\ndescription: A doc",
    ],
    [
      "a comment beside a value",
      "description: A doc # the short one",
    ],
    [
      "keys in an order of the author's choosing",
      "whenToUse:\n  - When you need it\ndescription: A doc\nowner: platform-team",
    ],
    [
      "a quoted value",
      'description: "A quoted description"',
    ],
    [
      "a single-quoted value",
      "description: 'A quoted description'",
    ],
    [
      "a value that has to stay quoted",
      'description: "yes"',
    ],
    [
      "every known key at once",
      [
        "description: A draft",
        "whenToUse:",
        "  - Writing code",
        "relatedDocs:",
        "  - other-doc",
        "status: editing",
        "selfReviewNotes: Looks fine",
        "confirmedAt: 2026-01-14T00:00:00.000Z",
        "approvedAt: 2026-01-15T00:00:00.000Z",
      ].join("\n"),
    ],
    [
      "known and unknown keys interleaved",
      "owner: platform-team\ndescription: A doc\nticket: PLAT-1\nwhenToUse:\n  - Testing",
    ],
    [
      "a non-ascii value",
      "description: 日本語の説明\nowner: 基盤チーム",
    ],
  ])("leaves %s exactly as it was", (_label, frontmatter) => {
    const before = doc(frontmatter);
    expect(rewriteUnchanged(before)).toBe(before);
  });

  it("leaves the body untouched, including its blank lines", () => {
    const body = "# Title\n\nFirst paragraph.\n\n## Section\n\n- a\n- b";
    const before = doc("description: A doc\nowner: platform-team", body);

    expect(stripFrontmatter(rewriteUnchanged(before))).toBe(body);
  });
});

describe("changing one field", () => {
  const before = doc(
    [
      "# Owned by the platform team",
      "owner: platform-team",
      "description: A host document",
      "tags:",
      "  - critical",
      "ticket: PLAT-4821",
    ].join("\n")
  );

  const after = updateFrontmatter({
    content: before,
    frontmatter: { ...parseFrontmatter(before), relatedDocs: ["other"] },
  });

  it("adds the field", () => {
    expect(parseFrontmatter(after).relatedDocs).toEqual(["other"]);
  });

  it.each([
    ["an unknown scalar key", "owner: platform-team"],
    ["an unknown key with a nested list", "tags:\n  - critical"],
    ["another unknown key", "ticket: PLAT-4821"],
    ["the comment", "# Owned by the platform team"],
  ])("keeps %s", (_label, fragment) => {
    expect(after).toContain(fragment);
  });

  it("does not reorder what was already there", () => {
    // `owner` was written before `description`, and stays before it.
    expect(after.indexOf("owner:")).toBeLessThan(after.indexOf("description:"));
  });
});

describe("removing a field", () => {
  it("removes only that field", () => {
    const before = doc("description: A doc\nowner: platform-team\nrelatedDocs:\n  - other");

    const after = updateFrontmatter({
      content: before,
      frontmatter: { ...parseFrontmatter(before), relatedDocs: undefined },
    });

    expect(after).not.toContain("relatedDocs");
    expect(after).toContain("owner: platform-team");
    expect(after).toContain("description: A doc");
  });
});

describe("quoting", () => {
  it.each([
    ['double-quoted', 'description: "A quoted description"'],
    ["single-quoted", "description: 'A quoted description'"],
  ])("strips the quotes from a %s value rather than keeping them in it", (_label, line) => {
    // The old parser handed back `"A quoted description"`, quote marks and all.
    // `description` is searched by `list(query:)` and written back by `update`,
    // so the broken value travelled into both.
    expect(parseFrontmatter(doc(line)).description).toBe("A quoted description");
  });

  it("writes a plain value plainly", () => {
    const written = updateFrontmatter({
      content: "# Title\n\nBody",
      frontmatter: { description: "A plain description" },
    });

    expect(written).toContain("description: A plain description");
  });

  it("still quotes a value that would not survive plain", () => {
    const written = updateFrontmatter({
      content: "# Title\n\nBody",
      frontmatter: { description: "yes" },
    });

    // Unquoted `yes` would read back as a boolean.
    expect(parseFrontmatter(written).description).toBe("yes");
  });
});

describe("frontmatter that cannot be parsed", () => {
  const malformed = doc("description: A doc\n:stray\ndangling\nwhenToUse:\n  - Testing");

  it("still reads the keys that come before the damage", () => {
    expect(parseFrontmatter(malformed).description).toBe("A doc");
  });

  it("does not write back a guess at what the damage meant", () => {
    // `yaml` folds the stray lines into one invented key. Serialising that
    // guess would replace the file with something nobody wrote, so a write
    // starts from an empty block instead.
    const after = updateFrontmatter({
      content: malformed,
      frontmatter: { description: "A doc" },
    });

    expect(after).not.toContain("stray");
    expect(after).not.toContain("dangling");
    expect(after).toContain("description: A doc");
  });
});
