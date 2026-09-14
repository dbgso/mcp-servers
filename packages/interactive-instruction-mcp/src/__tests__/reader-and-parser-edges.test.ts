/**
 * The reader's and the parser's remaining branches.
 *
 * These are the places where something is absent or unreadable: a documents
 * directory that is not there versus one that cannot be read, an empty file,
 * a rename whose backlinks are left alone, a `relatedDocs` that is not a list.
 * A reader that confuses "no documents" with "cannot read documents" reports an
 * empty corpus, which is the failure mode this whole session keeps meeting.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { DRAFT_DIR, TRASH_DIR, isInternalDocument } from "../constants.js";
import {
  parseFrontmatter,
  stripFrontmatter,
  updateFrontmatter,
} from "../utils/frontmatter-parser.js";
import { scopedStateDir } from "../services/instance-scope.js";
import { withTrailingNewline } from "../utils/string-utils.js";

let tempDir: string;
let docsDir: string;
let reader: MarkdownReader;

async function write(params: { id: string; content: string }): Promise<void> {
  const file = path.join(docsDir, `${params.id.split("__").join(path.sep)}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, params.content, "utf-8");
  reader.invalidateCache();
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reader-edges-"));
  docsDir = path.join(tempDir, "docs");
  await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
  reader = new MarkdownReader(docsDir);
});

afterEach(async () => {
  await fs.chmod(docsDir, 0o755).catch(() => {});
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("a directory that cannot be read", () => {
  it("reports an empty corpus when there is no directory", async () => {
    // ENOENT is "nothing here yet", which is the ordinary state of a new
    // project and not something to fail on.
    const absent = new MarkdownReader(path.join(tempDir, "not-created"));

    const { documents } = await absent.listDocuments({ recursive: true });

    expect(documents).toEqual([]);
  });

  it("does not swallow any other read error", async () => {
    // A permissions problem reported as an empty corpus is the worst outcome:
    // the caller writes a document that already exists, or concludes the
    // corpus is empty and starts over. Only ENOENT is "nothing here yet".
    await write({ id: "present", content: "---\ndescription: d\n---\n\n# P\n" });
    await fs.chmod(docsDir, 0o000);

    await expect(reader.listDocuments({ recursive: true })).rejects.toThrow(/EACCES|permission/);
  });
});

describe("the trailing-newline rule", () => {
  it.each([
    { name: "adds the terminator", input: "# T", expected: "# T\n" },
    { name: "leaves one alone", input: "# T\n", expected: "# T\n" },
    { name: "does not collapse a deliberate blank line", input: "# T\n\n", expected: "# T\n\n" },
    // A file with content gets terminated; a file with none is a different
    // thing from a file containing one blank line.
    { name: "leaves an empty document empty", input: "", expected: "" },
  ])("$name", ({ input, expected }) => {
    expect(withTrailingNewline(input)).toBe(expected);
  });

  it("refuses to write a document with no description at all", async () => {
    // Which is why the empty case above cannot arrive through `updateDocument`:
    // the description check runs first.
    await write({ id: "empty", content: "---\ndescription: d\n---\n\n# E\n" });

    const result = await reader.updateDocument({ id: "empty", content: "" });

    expect(result.success).toBe(false);
  });
});

describe("trashing a document", () => {
  it("refuses a document another server owns", async () => {
    // `chain__*` is traceable-chain-mcp's. Deleting one because it happens to
    // share a directory is the one mistake the scope exists to prevent.
    const scoped = new MarkdownReader(docsDir, { include: [], exclude: ["chain"] });
    await write({ id: "chain__adr__01", content: "---\ndescription: d\n---\n\n# C\n" });

    const result = await scoped.trashDocument("chain__adr__01");

    expect(result.success).toBe(false);
    // `documentExists` reports false for a document out of scope, so the check
    // that matters is that the bytes are where they were.
    expect(await reader.documentExists("chain__adr__01")).toBe(true);
  });

  it("says so when there is nothing to trash", async () => {
    const result = await reader.trashDocument("absent");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("reports the failure rather than the move", async () => {
    await write({ id: "doomed", content: "---\ndescription: d\n---\n\n# Doomed\n" });
    // A plain file where the trash directory should go: mkdir cannot proceed.
    await fs.writeFile(path.join(docsDir, TRASH_DIR), "not a directory", "utf-8");

    const result = await reader.trashDocument("doomed");

    expect(result.success).toBe(false);
    // Reported as a failure, and the document is still where it was.
    expect(await reader.documentExists("doomed")).toBe(true);
  });
});

describe("renaming", () => {
  it("leaves backlinks alone when told not to touch them", async () => {
    await write({ id: "target", content: "---\ndescription: t\n---\n\n# T\n" });
    await write({
      id: "referrer",
      content: "---\ndescription: r\nrelatedDocs:\n  - target\n---\n\n# R\n",
    });

    const result = await reader.renameDocument({
      oldId: "target",
      newId: "moved",
      updateBacklinks: false,
    });

    expect(result.success).toBe(true);
    expect(result.updatedBacklinks ?? []).toEqual([]);
    // The link now dangles, which `graph` draws and `lint` reports.
    expect(await reader.getDocumentContent("referrer")).toContain("target");
  });

  it("rewrites only the documents that actually point at it", async () => {
    await write({ id: "target", content: "---\ndescription: t\n---\n\n# T\n" });
    await write({
      id: "referrer",
      content: "---\ndescription: r\nrelatedDocs:\n  - target\n---\n\n# R\n",
    });
    await write({ id: "bystander", content: "---\ndescription: b\n---\n\n# B\n" });

    const result = await reader.renameDocument({
      oldId: "target",
      newId: "moved",
      updateBacklinks: true,
    });

    expect(result.updatedBacklinks).toEqual(["referrer"]);
    expect(await reader.getDocumentContent("referrer")).toContain("moved");
  });

  it("keeps the other links in a document it rewrites", async () => {
    await write({ id: "target", content: "---\ndescription: t\n---\n\n# T\n" });
    await write({ id: "other", content: "---\ndescription: o\n---\n\n# O\n" });
    await write({
      id: "referrer",
      content: "---\ndescription: r\nrelatedDocs:\n  - target\n  - other\n---\n\n# R\n",
    });

    await reader.renameDocument({ oldId: "target", newId: "moved", updateBacklinks: true });

    const written = await reader.getDocumentContent("referrer");
    expect(written).toContain("moved");
    expect(written).toContain("other");
  });
});

describe("the frontmatter parser", () => {
  it("ignores a relatedDocs that is not a list", async () => {
    // `relatedDocs: 3` is malformed. Reading it as `["3"]` would invent a
    // link to a document that cannot exist.
    expect(parseFrontmatter("---\nrelatedDocs: 3\n---\n\nbody").relatedDocs).toBeUndefined();
  });

  it("reads a single scalar as a one-item list", async () => {
    // Written by hand, and the parser this replaced accepted it.
    expect(parseFrontmatter("---\nwhenToUse: one trigger\n---\n\nbody").whenToUse).toEqual([
      "one trigger",
    ]);
  });

  it("drops non-string entries from a list rather than stringifying them", async () => {
    expect(parseFrontmatter("---\nrelatedDocs:\n  - a\n  - 2\n---\n\nbody").relatedDocs).toEqual([
      "a",
    ]);
  });

  it("writes a block mapping, not the flow form", async () => {
    // A document that had no frontmatter starts from an empty mapping, which
    // stringifies as `{}` unless it is forced back to block style.
    const written = updateFrontmatter({
      content: "# T\n",
      frontmatter: { description: "d", whenToUse: ["w"] },
    });

    expect(written).toContain("description: d");
    expect(written).not.toContain("{");
  });

  it("emits an empty block for a document with no metadata", async () => {
    const written = updateFrontmatter({ content: "# T\n", frontmatter: {} });

    expect(written.startsWith("---\n\n---")).toBe(true);
  });

  it("strips frontmatter with CRLF delimiters", async () => {
    expect(stripFrontmatter("---\r\ndescription: d\r\n---\r\n\r\n# Body")).toBe("# Body");
  });
});

describe("state directories", () => {
  it("falls back to a shared directory when no documents directory is known", async () => {
    // A server started without `--docs` has nothing to scope by; sharing is
    // then the honest behaviour rather than inventing a key.
    const shared = scopedStateDir({ base: "store", docsDir: null });

    expect(shared).toBe(path.join(os.tmpdir(), "store"));
  });
});

describe("internal directories", () => {
  it("refuses an id that climbs out of the documents directory", async () => {
    const result = await reader.addDocument({
      id: "..__..__escaped",
      content: "---\ndescription: d\n---\n\n# E\n",
    });

    expect(result.success).toBe(false);
  });

  it.each([
    { id: `${DRAFT_DIR}__topic`, internal: true },
    { id: `${TRASH_DIR}__gone--2026-01-01`, internal: true },
    { id: DRAFT_DIR, internal: true },
    // Segment-aware: an ordinary document that starts with the same letters.
    { id: `${DRAFT_DIR}y__topic`, internal: false },
    { id: "git__workflow", internal: false },
  ])("$id -> internal: $internal", ({ id, internal }) => {
    expect(isInternalDocument(id)).toBe(internal);
  });
});
