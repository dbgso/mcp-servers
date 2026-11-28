/**
 * `read` answers with a document's prose and nothing else.
 *
 * Metadata leaves the corpus only when someone asks for metadata. Frontmatter
 * is how the corpus is navigated -- `description`, `whenToUse`, `relatedDocs`
 * -- and for a draft it also carries the approval conversation: `status`, and
 * `selfReviewNotes`, which is the AI's account of its own work. Reported as
 * #50: a reader got a paragraph of review notes at the top of the document on
 * every `read`, for all 7 documents in that session. Stripping it at promotion
 * fixed the published copy; this is the other half, and it covers every field
 * rather than the one that was noticed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR } from "../constants.js";
import { ReadHandler } from "../tools/instruction/handlers/read.js";
import { ReadMetaHandler } from "../tools/instruction/handlers/read-meta.js";
import type { InstructionContext, ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

let tempDir: string;
let docsDir: string;
let reader: MarkdownReader;
let context: InstructionContext;

const read = new ReadHandler();
const readMeta = new ReadMetaHandler();

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

/**
 * The document part of the answer, without the next-action suggestions.
 * Those quote `relatedDocs` in an example, which is the tool teaching its own
 * syntax rather than the document's metadata leaking.
 */
const body = (r: { content: { type: string; text?: string }[] }) =>
  text(r).split("**Next actions:**")[0];

async function write(params: { id: string; content: string }): Promise<void> {
  const file = path.join(docsDir, `${params.id}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, params.content, "utf-8");
  reader.invalidateCache();
}

const PROMOTED = `---
description: What this document is for
whenToUse:
  - deciding something
relatedDocs:
  - other-doc
approvedAt: 2026-01-01T00:00:00.000Z
---

# The Title

The first paragraph.

---

## After a horizontal rule

The last paragraph.
`;

const DRAFT = `---
description: A draft
whenToUse:
  - testing
status: user_reviewing
selfReviewNotes: I checked the criteria and believe this is ready for review.
confirmedAt: 2026-01-01T00:00:00.000Z
---

# Draft Title

Draft body.
`;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "read-metadata-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
  context = { reader, config };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("reading a promoted document", () => {
  beforeEach(async () => {
    await write({ id: "promoted", content: PROMOTED });
  });

  it("answers with the prose", async () => {
    const result = await read.execute({ rawParams: { action: "read", id: "promoted" }, context });

    expect(text(result)).toContain("# The Title");
    expect(text(result)).toContain("The last paragraph.");
  });

  it.each([
    "description:",
    "whenToUse:",
    "relatedDocs:",
    "approvedAt:",
    "What this document is for",
    "deciding something",
  ])("leaves %s out", async (fragment) => {
    const result = await read.execute({ rawParams: { action: "read", id: "promoted" }, context });

    expect(body(result)).not.toContain(fragment);
  });

  it("keeps a horizontal rule that belongs to the body", async () => {
    // Only the leading frontmatter block goes. A `---` between paragraphs is
    // the author's, and removing it would rewrite the document.
    const result = await read.execute({ rawParams: { action: "read", id: "promoted" }, context });

    expect(text(result)).toContain("## After a horizontal rule");
    expect(body(result)).toContain("\n---\n");
  });

  it("says where the metadata can be read instead", async () => {
    const result = await read.execute({ rawParams: { action: "read", id: "promoted" }, context });

    expect(text(result)).toContain('action: "read_meta"');
  });
});

describe("reading a draft", () => {
  beforeEach(async () => {
    await write({ id: path.join(DRAFT_DIR, "drafted"), content: DRAFT });
  });

  it("answers with the prose, marked as a draft", async () => {
    const result = await read.execute({ rawParams: { action: "read", id: "drafted" }, context });

    expect(text(result)).toContain("**[Draft]** drafted");
    expect(text(result)).toContain("Draft body.");
  });

  it.each([
    "status:",
    "selfReviewNotes:",
    "confirmedAt:",
    "user_reviewing",
    "I checked the criteria",
  ])("leaves the approval conversation's %s out", async (fragment) => {
    const result = await read.execute({ rawParams: { action: "read", id: "drafted" }, context });

    expect(body(result)).not.toContain(fragment);
  });
});

describe("asking for metadata", () => {
  it("is what read_meta answers", async () => {
    // The rule is not "metadata is hidden" but "metadata comes out when it is
    // what was asked for".
    await write({ id: "promoted", content: PROMOTED });

    const result = await readMeta.execute({
      rawParams: { action: "read_meta", id: "promoted" },
      context,
    });

    expect(text(result)).toContain("What this document is for");
    expect(text(result)).toContain("deciding something");
  });
});

describe("what a document with no frontmatter reads as", () => {
  it("is itself, unchanged", async () => {
    await write({ id: "bare", content: "# Bare\n\nNo frontmatter at all.\n" });

    const result = await read.execute({ rawParams: { action: "read", id: "bare" }, context });

    expect(text(result)).toContain("# Bare");
    expect(text(result)).toContain("No frontmatter at all.");
  });
});

describe("read_meta on a draft", () => {
  it("finds it under the draft prefix, and says it is one", async () => {
    // `read` answers with prose, and a draft appears in `list` only when asked for with `drafts: true`, so this
    // is the only way to see what a draft's metadata says -- which is when it
    // most needs work.
    await write({ id: path.join(DRAFT_DIR, "drafted"), content: DRAFT });

    const result = await readMeta.execute({
      rawParams: { action: "read_meta", id: "drafted" },
      context,
    });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("**[Draft]**");
    expect(text(result)).toContain("A draft");
    expect(text(result)).toContain("testing");
  });

  it("leaves the approval conversation out of it", async () => {
    // Metadata here means what the corpus is navigated by. `status` and
    // `selfReviewNotes` are the approval conversation, and this tool is for
    // writing a description -- not for reading back the review.
    await write({ id: path.join(DRAFT_DIR, "drafted"), content: DRAFT });

    const result = await readMeta.execute({
      rawParams: { action: "read_meta", id: "drafted" },
      context,
    });

    expect(text(result)).not.toContain("selfReviewNotes");
    expect(text(result)).not.toContain("I checked the criteria");
    expect(text(result)).not.toContain("user_reviewing");
  });

  it("prefers the promoted document when both exist", async () => {
    // Both can exist while an update is staged; the promoted one is what the
    // corpus reads, so it is what a metadata review is about.
    await write({ id: "both", content: PROMOTED });
    await write({ id: path.join(DRAFT_DIR, "both"), content: DRAFT });

    const result = await readMeta.execute({
      rawParams: { action: "read_meta", id: "both" },
      context,
    });

    expect(text(result)).toContain("What this document is for");
    expect(text(result)).not.toContain("**[Draft]**");
  });

  it("still reports an id that is neither", async () => {
    const result = await readMeta.execute({
      rawParams: { action: "read_meta", id: "absent" },
      context,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("not found");
  });
});

describe("the fields the tools wrote", () => {
  it("reports approvedAt, marked as a record rather than a setting", async () => {
    // `approve` stamps it when a document enters the corpus, and `read` no
    // longer shows it. A value written into someone's file with no way to read
    // it back is worse than not writing it, so this is where it surfaces --
    // apart from the fields the caller is being asked to write, so the list
    // does not read as an invitation to set it.
    await write({ id: "promoted", content: PROMOTED });

    const result = await readMeta.execute({
      rawParams: { action: "read_meta", id: "promoted" },
      context,
    });

    expect(text(result)).toContain("## Also recorded");
    expect(text(result)).toContain("approvedAt");
    expect(text(result)).toContain("2026-01-01T00:00:00.000Z");
    expect(text(result)).toContain("recorded on promotion");
    // Not among the three it asks for.
    const asksFor = text(result).split("## Also recorded")[0];
    expect(asksFor).not.toContain("approvedAt");
  });

  it("reports a size exemption, which is written for lint rather than navigation", async () => {
    await write({
      id: "exempt",
      content: `---\ndescription: A long one\nsizeExemption: it is a single decision record\n---\n\n# Long\n\nBody.\n`,
    });

    const result = await readMeta.execute({
      rawParams: { action: "read_meta", id: "exempt" },
      context,
    });

    expect(text(result)).toContain("sizeExemption");
    expect(text(result)).toContain("a single decision record");
  });

  it("leaves the section out when there is nothing recorded", async () => {
    // A heading with nothing under it is noise on every draft.
    await write({ id: path.join(DRAFT_DIR, "drafted"), content: DRAFT });

    const result = await readMeta.execute({
      rawParams: { action: "read_meta", id: "drafted" },
      context,
    });

    expect(text(result)).not.toContain("## Also recorded");
  });

  it("still keeps the approval conversation out of it", async () => {
    // `confirmedAt` is the workflow's, not a record of the document.
    await write({ id: path.join(DRAFT_DIR, "drafted"), content: DRAFT });

    const result = await readMeta.execute({
      rawParams: { action: "read_meta", id: "drafted" },
      context,
    });

    expect(text(result)).not.toContain("confirmedAt");
  });
});
