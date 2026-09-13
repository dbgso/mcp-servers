import { describe, it, expect } from "vitest";
import { hasChangelogEntry, findUngatedReleases } from "../verify-changelog-gate.mjs";

// The shape `changeset version` writes.
const CHANGELOG = `# kroki-mcp

## 0.1.1

### Patch Changes

- 5dcc941: Ship a bundled binary.

## 0.1.0

### Minor Changes

- abc1234: Initial release.
`;

describe("hasChangelogEntry", () => {
  it.each(["0.1.1", "0.1.0"])("finds the section for %s", (version) => {
    expect(hasChangelogEntry(CHANGELOG, version)).toBe(true);
  });

  it.each([
    ["a version with no section", CHANGELOG, "0.2.0"],
    ["a missing CHANGELOG", null, "0.1.1"],
    // The version as a prefix of another must not count: 0.1.1 is not 0.1.10.
    ["a version that only prefixes a heading", "## 0.1.10\n", "0.1.1"],
    // A dot is literal, not "any character".
    ["a heading that differs only where a dot is", "## 0x1x1\n", "0.1.1"],
    ["the version mentioned outside a heading", "- bumped to 0.1.1\n", "0.1.1"],
    ["a deeper heading", "### 0.1.1\n", "0.1.1"],
  ])("rejects %s", (_, changelog, version) => {
    expect(hasChangelogEntry(changelog, version)).toBe(false);
  });

  it("accepts trailing whitespace after the version", () => {
    expect(hasChangelogEntry("## 1.0.0  \n", "1.0.0")).toBe(true);
  });

  it("handles prerelease versions literally", () => {
    expect(hasChangelogEntry("## 1.0.0-next.0\n", "1.0.0-next.0")).toBe(true);
  });
});

describe("findUngatedReleases", () => {
  const base = { name: "kroki-mcp", version: "0.1.1", changelog: CHANGELOG, published: false };

  it("passes a version to be published that has its CHANGELOG section", () => {
    expect(findUngatedReleases([base])).toEqual([]);
  });

  it.each([
    ["already published", { published: true, changelog: null }],
    ["private", { private: true, changelog: null }],
  ])("ignores a package that is %s, since changesets will not publish it", (_, overrides) => {
    expect(findUngatedReleases([{ ...base, ...overrides }])).toEqual([]);
  });

  // The case this gate exists for: a version bumped by hand.
  it("flags a version to be published with no CHANGELOG section", () => {
    expect(findUngatedReleases([{ ...base, version: "0.2.0" }])).toEqual([
      { name: "kroki-mcp", version: "0.2.0", reason: 'no "## 0.2.0" section in CHANGELOG.md' },
    ]);
  });

  // `private` removed from a package that never had a changeset.
  it("flags a package to be published with no CHANGELOG at all", () => {
    expect(findUngatedReleases([{ ...base, name: "ast-file-mcp", changelog: null }])).toEqual([
      { name: "ast-file-mcp", version: "0.1.1", reason: "no CHANGELOG.md" },
    ]);
  });

  it("only honours a literal private: true, matching npm", () => {
    expect(findUngatedReleases([{ ...base, private: "true", changelog: null }])).toHaveLength(1);
  });

  it("reports every offender, not only the first", () => {
    const result = findUngatedReleases([
      { ...base, name: "a", version: "9.0.0" },
      base,
      { ...base, name: "b", changelog: null },
    ]);
    expect(result.map((r) => r.name)).toEqual(["a", "b"]);
  });
});
