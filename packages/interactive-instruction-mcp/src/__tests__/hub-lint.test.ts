import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { LintHandler } from "../tools/instruction/handlers/lint.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { InstructionContext } from "../tools/instruction/types.js";
import type { ReminderConfig } from "../types/index.js";
import {
  checkHubIndex,
  checkMisplacedHub,
  checkPrefersHub,
  childCandidates,
  childrenByParent,
  configuredMinChildren,
  parentIdOf,
  referencesOf,
  type HubDocument,
} from "../services/hub-lint.js";

const doc = (params: {
  id: string;
  relatedDocs?: string[];
  body?: string;
}): HubDocument => ({
  id: params.id,
  relatedDocs: params.relatedDocs,
  content: params.body ?? "# Title\n\nbody\n",
});

/** The wiring the lint handler does, so a test exercises the same decisions. */
function findings(docs: HubDocument[]) {
  const ids = docs.map((d) => d.id);
  const existing = new Set(ids);
  const families = childrenByParent(ids);
  const hubs = new Set([...families.keys()].filter((id) => existing.has(id)));
  const candidates = childCandidates(ids);

  return docs.flatMap((d) => {
    const referenced = referencesOf({ doc: d, candidates });
    const index = hubs.has(d.id)
      ? checkHubIndex({ hub: d, children: families.get(d.id) ?? [], referenced })
      : [];
    return [
      ...checkPrefersHub({ doc: d, referenced, hubs }),
      ...checkMisplacedHub({ doc: d, hubs, families }),
      ...index,
    ];
  });
}

const rulesFor = (docs: HubDocument[], id: string) =>
  findings(docs).filter((i) => i.docId === id).map((i) => i.rule);

describe("parentIdOf", () => {
  it.each([
    ["workflow__constraint-ladder", "workflow"],
    ["policy__approval", "policy"],
    ["chain__design__01ABC", "chain__design"],
    ["every-task", null],
    ["", null],
    ["__leading", null],
  ])("%s -> %s", (id, expected) => {
    expect(parentIdOf(id)).toBe(expected);
  });
});

describe("prefer-hub-reference", () => {
  /**
   * The case this rule exists for, as it actually stood.
   *
   * `every-task` named five `workflow__*` rules one by one, and no `workflow`
   * document existed at the time. A rule that waited for the hub to appear
   * would have said nothing through the whole of it, which is why the advice
   * changes rather than the rule staying silent.
   */
  it("reports the list that #81 removed by hand, and says to write the hub", () => {
    const corpus = [
      doc({
        id: "every-task",
        relatedDocs: ["policy", "workflow__measure-dont-assume"],
        body: [
          "- **DRY**: See `workflow__dry-principle`",
          "- **AST**: See `workflow__ast-tool-evolution`",
          "- **Plan**: See `workflow__plan-tool-required`",
          "- **Reporting**: See `workflow__verification-reporting`",
        ].join("\n"),
      }),
      doc({ id: "policy" }),
      doc({ id: "workflow__measure-dont-assume" }),
      doc({ id: "workflow__dry-principle" }),
      doc({ id: "workflow__ast-tool-evolution" }),
      doc({ id: "workflow__plan-tool-required" }),
      doc({ id: "workflow__verification-reporting" }),
    ];

    const issues = findings(corpus).filter((i) => i.docId === "every-task");

    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("prefer-hub-reference");
    expect(issues[0].message).toContain("Names 5 documents");
    expect(issues[0].message).toContain('No "workflow" document exists');
    expect(issues[0].message).toContain("Write the hub");
  });

  it("says to point at the hub once the hub exists", () => {
    const corpus = [
      doc({ id: "every-task", relatedDocs: ["workflow__a", "workflow__b"] }),
      doc({ id: "workflow", relatedDocs: ["workflow__a", "workflow__b"] }),
      doc({ id: "workflow__a" }),
      doc({ id: "workflow__b" }),
    ];

    const issues = findings(corpus).filter((i) => i.docId === "every-task");

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Point at "workflow"');
    expect(issues[0].message).not.toContain("does not exist");
  });

  it.each([
    {
      name: "one child is a citation, not an index",
      docs: () => [
        doc({ id: "every-task", relatedDocs: ["workflow__a"] }),
        doc({ id: "workflow" }),
        doc({ id: "workflow__a" }),
      ],
      of: "every-task",
    },
    {
      name: "the hub is allowed to list its own children",
      docs: () => [
        doc({ id: "workflow", relatedDocs: ["workflow__a", "workflow__b"] }),
        doc({ id: "workflow__a" }),
        doc({ id: "workflow__b" }),
      ],
      of: "workflow",
    },
    {
      name: "a sibling cross-referencing its own family is not keeping an index",
      docs: () => [
        doc({ id: "workflow" }),
        doc({ id: "workflow__a", relatedDocs: ["workflow__b", "workflow__c"] }),
        doc({ id: "workflow__b" }),
        doc({ id: "workflow__c" }),
      ],
      of: "workflow__a",
    },
  ])("does not report: $name", ({ docs, of }) => {
    expect(rulesFor(docs(), of)).not.toContain("prefer-hub-reference");
  });

  /**
   * A hub named for what it is about -- `policy`, `workflow` -- is an ordinary
   * word, and the body is prose. Searching for the bare hub name would report
   * a sentence about policy as a reference to the document.
   */
  it("does not read an ordinary word in the prose as a reference", () => {
    const corpus = [
      doc({ id: "a-doc", body: "Our policy is to write the workflow down." }),
      doc({ id: "policy" }),
      doc({ id: "policy__approval" }),
      doc({ id: "workflow" }),
      doc({ id: "workflow__a" }),
    ];

    expect(findings(corpus).filter((i) => i.docId === "a-doc")).toEqual([]);
  });

  it("does not match an id that is only part of a longer word", () => {
    const corpus = [
      doc({ id: "a-doc", body: "see workflow__a-b and workflow__a-c" }),
      doc({ id: "workflow" }),
      doc({ id: "workflow__a" }),
      doc({ id: "workflow__a-b" }),
      doc({ id: "workflow__a-c" }),
    ];

    const issues = findings(corpus).filter((i) => i.docId === "a-doc");

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("workflow__a-b");
    expect(issues[0].message).not.toContain("workflow__a,");
  });
});

describe("stale-hub-index", () => {
  it("reports the children the hub does not reference", () => {
    const corpus = [
      doc({ id: "release", relatedDocs: ["release__changesets"] }),
      doc({ id: "release__changesets" }),
      doc({ id: "release__npm-oidc" }),
      doc({ id: "release__docker-package" }),
    ];

    const issues = findings(corpus).filter((i) => i.docId === "release");

    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("stale-hub-index");
    expect(issues[0].message).toContain("release__npm-oidc");
    expect(issues[0].message).toContain("release__docker-package");
    expect(issues[0].message).not.toContain("release__changesets");
  });

  it("reports a child the hub names that no longer exists", () => {
    const corpus = [
      doc({ id: "release", relatedDocs: ["release__changesets", "release__renamed-away"] }),
      doc({ id: "release__changesets" }),
    ];

    const issues = findings(corpus).filter((i) => i.docId === "release");

    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("stale-hub-index");
    expect(issues[0].message).toContain("release__renamed-away");
    expect(issues[0].message).toContain("do not exist");
  });

  it("says nothing about a hub whose list matches the directory", () => {
    const corpus = [
      doc({ id: "release", relatedDocs: ["release__a", "release__b"] }),
      doc({ id: "release__a" }),
      doc({ id: "release__b" }),
    ];

    expect(findings(corpus).filter((i) => i.docId === "release")).toEqual([]);
  });

  it("counts a child named in the body, not only in relatedDocs", () => {
    const corpus = [
      doc({ id: "release", body: "Start at `release__a`, then `release__b`." }),
      doc({ id: "release__a" }),
      doc({ id: "release__b" }),
    ];

    expect(findings(corpus).filter((i) => i.docId === "release")).toEqual([]);
  });

  it("is not a hub when no document by the parent's name was written", () => {
    const corpus = [doc({ id: "release__a" }), doc({ id: "release__b" })];

    expect(findings(corpus).map((i) => i.rule)).not.toContain("stale-hub-index");
  });
});

describe("misplaced-hub", () => {
  /**
   * The case the first two rules could not reach, and the reason it was missed.
   *
   * `stale-hub-index` needs a document at the family's id to check against the
   * directory, and the whole defect is that there is none -- so this repository's
   * `coding-rules__overview` named 14 of its 18 siblings, and one that does not
   * exist, with nothing saying so. It surfaced from writing down what a hub is,
   * after the detection had already been built.
   */
  it("reports an index living inside what it indexes", () => {
    const corpus = [
      doc({ id: "coding-rules__overview", relatedDocs: ["coding-rules__style"] }),
      doc({ id: "coding-rules__style" }),
      doc({ id: "coding-rules__typescript" }),
    ];

    const issues = findings(corpus).filter((i) => i.rule === "misplaced-hub");

    expect(issues).toHaveLength(1);
    expect(issues[0].docId).toBe("coding-rules__overview");
    expect(issues[0].message).toContain('Rename it to "coding-rules"');
  });

  it.each(["overview", "index", "readme", "README", "Overview"])(
    "recognises %s as a hub put in the wrong place",
    (name) => {
      const corpus = [
        doc({ id: `family__${name}` }),
        doc({ id: "family__a" }),
        doc({ id: "family__b" }),
      ];

      expect(findings(corpus).map((i) => i.rule)).toContain("misplaced-hub");
    },
  );

  it.each([
    {
      name: "the family already has its hub",
      docs: () => [
        doc({ id: "family" }),
        doc({ id: "family__overview" }),
        doc({ id: "family__a" }),
      ],
    },
    {
      name: "there is no family to index",
      docs: () => [doc({ id: "family__overview" })],
    },
    {
      name: "an ordinary document under a family with no hub",
      docs: () => [doc({ id: "family__a" }), doc({ id: "family__b" })],
    },
    {
      name: "a top-level document called overview",
      docs: () => [doc({ id: "overview" }), doc({ id: "family__a" }), doc({ id: "family__b" })],
    },
  ])("does not report: $name", ({ docs }) => {
    expect(findings(docs()).map((i) => i.rule)).not.toContain("misplaced-hub");
  });
});

describe("configuredMinChildren", () => {
  const original = process.env.IIMCP_LINT_HUB_CHILDREN;
  afterEach(() => {
    if (original === undefined) delete process.env.IIMCP_LINT_HUB_CHILDREN;
    else process.env.IIMCP_LINT_HUB_CHILDREN = original;
  });

  it.each([
    ["3", 3],
    ["10", 10],
    ["1", 2],
    ["0", 2],
    ["-1", 2],
    ["2.5", 2],
    ["many", 2],
    ["", 2],
  ])("IIMCP_LINT_HUB_CHILDREN=%s -> %i", (raw, expected) => {
    process.env.IIMCP_LINT_HUB_CHILDREN = raw;
    expect(configuredMinChildren()).toBe(expected);
  });

  it("defaults to 2 when unset", () => {
    delete process.env.IIMCP_LINT_HUB_CHILDREN;
    expect(configuredMinChildren()).toBe(2);
  });

  it("raising it silences what it is raised past", () => {
    const corpus = [
      doc({ id: "a-doc", relatedDocs: ["workflow__a", "workflow__b"] }),
      doc({ id: "workflow" }),
      doc({ id: "workflow__a" }),
      doc({ id: "workflow__b" }),
    ];

    expect(rulesFor(corpus, "a-doc")).toContain("prefer-hub-reference");
    process.env.IIMCP_LINT_HUB_CHILDREN = "3";
    expect(rulesFor(corpus, "a-doc")).not.toContain("prefer-hub-reference");
  });
});

describe("LintHandler reports the hub rules", () => {
  let tempDir: string;
  let docsDir: string;
  let handler: LintHandler;
  let context: InstructionContext;

  const config: ReminderConfig = {
    remindMcp: false,
    remindOrganize: false,
    customReminders: [],
    topicForEveryTask: null,
    infoValidSeconds: 60,
  };

  const write = async (params: { id: string; frontmatter: string; body: string }) => {
    const file = path.join(docsDir, `${params.id.replaceAll("__", "/")}.md`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `---\n${params.frontmatter}\n---\n\n${params.body}\n`);
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hub-lint-test-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });
    handler = new LintHandler();
    context = { reader: new MarkdownReader(docsDir), config };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("names both rules in the report", async () => {
    const meta = (description: string) =>
      `description: ${description}\nwhenToUse:\n  - When testing the hub rules`;

    await write({
      id: "guide",
      frontmatter: `${meta("A guide that indexes someone else's children")}\nrelatedDocs:\n  - workflow__a\n  - workflow__b`,
      body: "Read `workflow__a` and `workflow__b`.",
    });
    await write({
      id: "workflow",
      frontmatter: `${meta("The hub, which forgot one of its own")}\nrelatedDocs:\n  - workflow__a`,
      body: "The index.",
    });
    await write({ id: "workflow__a", frontmatter: meta("First child"), body: "One." });
    await write({ id: "workflow__b", frontmatter: meta("Second child"), body: "Two." });

    const result = await handler.execute({ rawParams: { action: "lint" }, context });
    const text = result.content[0].type === "text" ? result.content[0].text : "";

    expect(text).toContain("prefer-hub-reference");
    expect(text).toContain("stale-hub-index");
    expect(text).toContain("workflow__b");
  });
});
