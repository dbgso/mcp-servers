/**
 * The document-local rules, and the thresholds they are judged against.
 *
 * These are the checks `add`, `update` and `lint` share, so a case here covers
 * all three: the write-time tests below only assert that the report reaches the
 * response, not what each rule decides.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  checkDocument,
  configuredMaxLines,
  configuredSimilarityThreshold,
  formatWriteLint,
  headingsOf,
  type LintIssue,
} from "../services/document-lint.js";

/** A document with sound metadata, so a case only exercises what it changes. */
function documentOf(params: { body: string; extraFrontmatter?: string }): string {
  const { body, extraFrontmatter } = params;
  return `---
description: A document written for this test
whenToUse:
  - When testing the document-local lint rules
${extraFrontmatter === undefined ? "" : `${extraFrontmatter}\n`}---

${body}
`;
}

function rulesOf(issues: LintIssue[]): string[] {
  return issues.map((issue) => issue.rule);
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, i) => `Line ${i + 1}.`).join("\n");
}

describe("configuredMaxLines", () => {
  const original = process.env.IIMCP_LINT_MAX_LINES;

  afterEach(() => {
    if (original === undefined) delete process.env.IIMCP_LINT_MAX_LINES;
    else process.env.IIMCP_LINT_MAX_LINES = original;
  });

  it("defaults to 150", () => {
    delete process.env.IIMCP_LINT_MAX_LINES;
    expect(configuredMaxLines()).toBe(150);
  });

  it.each(["60", "400", "1"])("takes %o from the environment", (value) => {
    // What counts as "too long" depends on whether the corpus is runbooks or
    // task cards, which this package cannot know.
    process.env.IIMCP_LINT_MAX_LINES = value;
    expect(configuredMaxLines()).toBe(Number(value));
  });

  it.each(["0", "-10", "many", "", "1.5"])("ignores %o and keeps the default", (value) => {
    // A typo in an environment variable should not stop the server.
    process.env.IIMCP_LINT_MAX_LINES = value;
    expect(configuredMaxLines()).toBe(150);
  });

  it("is read per call, so the override reaches the rule", () => {
    process.env.IIMCP_LINT_MAX_LINES = "5";

    const issues = checkDocument({
      docId: "long-doc",
      content: documentOf({ body: lines(10) }),
    });

    expect(rulesOf(issues)).toContain("document-too-large");
    expect(issues[0].message).toContain("max recommended: 5");
  });
});

describe("configuredSimilarityThreshold", () => {
  const original = process.env.IIMCP_LINT_SIMILARITY;

  afterEach(() => {
    if (original === undefined) delete process.env.IIMCP_LINT_SIMILARITY;
    else process.env.IIMCP_LINT_SIMILARITY = original;
  });

  it("defaults to 0.6", () => {
    delete process.env.IIMCP_LINT_SIMILARITY;
    expect(configuredSimilarityThreshold()).toBe(0.6);
  });

  it.each(["0.3", "0.85", "1"])("takes %o from the environment", (value) => {
    process.env.IIMCP_LINT_SIMILARITY = value;
    expect(configuredSimilarityThreshold()).toBe(Number(value));
  });

  it.each(["0", "-0.5", "1.2", "half", ""])("ignores %o and keeps the default", (value) => {
    // 0 would make every pair of documents similar to every other, and a value
    // above 1 would silence the rule outright -- neither is what a typo meant.
    process.env.IIMCP_LINT_SIMILARITY = value;
    expect(configuredSimilarityThreshold()).toBe(0.6);
  });
});

describe("checkDocument", () => {
  it("says nothing about a sound document", () => {
    const issues = checkDocument({
      docId: "fine",
      content: documentOf({ body: "# Title\n\nOne topic, said once." }),
    });

    expect(issues).toEqual([]);
  });

  it.each([
    {
      name: "no description",
      content: `---
whenToUse:
  - When testing
---

# Title
`,
      rule: "missing-description",
      severity: "error",
    },
    {
      name: "no whenToUse",
      content: `---
description: Present, unlike whenToUse
---

# Title
`,
      rule: "missing-when-to-use",
      severity: "warning",
    },
    {
      name: "the reader's placeholder description",
      content: `---
description: (No description)
whenToUse:
  - When testing
---

# Title
`,
      rule: "missing-description",
      severity: "error",
    },
  ])("reports $name", ({ content, rule, severity }) => {
    const issues = checkDocument({ docId: "thin", content });

    const found = issues.find((issue) => issue.rule === rule);
    expect(found?.severity).toBe(severity);
  });

  it("counts the body, not the frontmatter", () => {
    // Describing a document well used to spend its size budget, so the rule
    // rewarded thin metadata.
    const manyTriggers = Array.from({ length: 40 }, (_, i) => `  - Trigger ${i}`).join("\n");
    const content = `---
description: A well described document
whenToUse:
${manyTriggers}
---

${lines(10)}
`;

    expect(rulesOf(checkDocument({ docId: "described", content }))).toEqual([]);
  });

  it.each([
    {
      name: "a long document with a reason to stay whole",
      body: lines(200),
      extraFrontmatter: "sizeExemption: A reference table is worth more whole",
      expected: [],
    },
    {
      name: "a long document with no reason",
      body: lines(200),
      extraFrontmatter: undefined,
      expected: ["document-too-large"],
    },
    {
      name: "an exemption with an empty reason",
      body: lines(200),
      extraFrontmatter: 'sizeExemption: ""',
      expected: ["size-exemption-without-reason", "document-too-large"],
    },
    {
      name: "an exemption the document has outgrown the need for",
      body: lines(10),
      extraFrontmatter: "sizeExemption: It used to be long",
      expected: ["stale-size-exemption"],
    },
  ])("reports $name as $expected", ({ body, extraFrontmatter, expected }) => {
    const issues = checkDocument({
      docId: "sized",
      content: documentOf({ body, extraFrontmatter }),
    });

    expect(rulesOf(issues)).toEqual(expected);
  });

  it("reports a heading that comes back", () => {
    const content = documentOf({
      body: "## Related\n\nOne.\n\n## Steps\n\nTwo.\n\n## Related\n\nThree.",
    });

    const issues = checkDocument({ docId: "appended", content });

    expect(rulesOf(issues)).toEqual(["duplicate-heading"]);
    expect(issues[0].message).toContain("## Related");
  });

  it("carries the document's id onto every issue", () => {
    const issues = checkDocument({
      docId: "some-doc",
      content: `---
---

${lines(200)}
`,
    });

    expect(issues.length).toBeGreaterThan(1);
    expect(issues.every((issue) => issue.docId === "some-doc")).toBe(true);
  });
});

describe("headingsOf", () => {
  it("skips headings inside fenced code", () => {
    const body = ["# Real", "", "```sh", "# not a heading", "```", "", "~~~", "# nor this", "~~~"].join("\n");

    expect(headingsOf(body)).toEqual([{ level: 1, text: "Real" }]);
  });

  it("treats a fence of the other kind as content", () => {
    const body = ["~~~", "```", "# inside", "~~~", "", "## After"].join("\n");

    expect(headingsOf(body)).toEqual([{ level: 2, text: "After" }]);
  });
});

describe("formatWriteLint", () => {
  it("says nothing when there is nothing to say", () => {
    expect(formatWriteLint([])).toBe("");
  });

  it("names each rule and says the document was still saved", () => {
    const section = formatWriteLint([
      { severity: "warning", docId: "d", rule: "document-too-large", message: "Too long." },
      { severity: "error", docId: "d", rule: "missing-description", message: "No description." },
    ]);

    expect(section).toContain("## Lint (2)");
    expect(section).toContain("[!] **document-too-large**");
    expect(section).toContain("[x] **missing-description**");
    expect(section).toContain("The document was saved.");
  });
});
