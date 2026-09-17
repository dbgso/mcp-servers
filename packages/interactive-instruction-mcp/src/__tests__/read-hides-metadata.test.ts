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
import { DRAFT_DIR, DRAFT_PREFIX } from "../constants.js";
import { ReadHandler } from "../tools/instruction/handlers/read.js";
import { UpdateMetaHandler } from "../tools/instruction/handlers/update-meta.js";
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
const updateMeta = new UpdateMetaHandler();

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

    expect(text(result)).toContain('action: "update_meta"');
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
  it("is what update_meta answers", async () => {
    // The rule is not "metadata is hidden" but "metadata comes out when it is
    // what was asked for".
    await write({ id: "promoted", content: PROMOTED });

    const result = await updateMeta.execute({
      rawParams: { action: "update_meta", id: "promoted" },
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
