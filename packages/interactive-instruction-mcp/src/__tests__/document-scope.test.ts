/**
 * Scope: which documents in the directory this server manages.
 *
 * The case it exists for is this repository's own `./docs`, which holds
 * `chain/` -- traceable-chain-mcp's documents, with their own frontmatter and
 * their own relation field. Every check this server makes reports them as
 * broken, which is most of what `lint` says.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { isManaged, describeScope, EMPTY_SCOPE } from "../services/document-scope.js";
import { MarkdownReader } from "../services/markdown-reader.js";

describe("isManaged", () => {
  it("manages everything when nothing is configured", () => {
    expect(isManaged({ id: "anything__at__all", scope: EMPTY_SCOPE })).toBe(true);
  });

  describe("exclude", () => {
    const scope = { include: [], exclude: ["chain"] };

    it.each([
      ["the prefix itself", "chain"],
      ["a child", "chain__adr"],
      ["a grandchild", "chain__adr__01KH42ADRJT0RM5A7Q1ZNVKRRJ"],
    ])("removes %s", (_label, id) => {
      expect(isManaged({ id, scope })).toBe(false);
    });

    it.each([
      ["an unrelated id", "coding-rules__general"],
      // `chain` must not take `chainsaw` with it: the character after the
      // prefix has to be a separator.
      ["an id that merely starts with the same letters", "chainsaw"],
      ["a deeper id that merely starts with them", "chainsaw__blade"],
    ])("keeps %s", (_label, id) => {
      expect(isManaged({ id, scope })).toBe(true);
    });
  });

  describe("include", () => {
    const scope = { include: ["coding-rules", "workflow"], exclude: [] };

    it.each([
      ["a listed prefix", "coding-rules__general", true],
      ["another listed prefix", "workflow__dry-principle", true],
      ["something unlisted", "release__npm-oidc", false],
      ["a top-level document", "every-task", false],
    ])("%s -> %s", (_label, id, expected) => {
      expect(isManaged({ id, scope })).toBe(expected);
    });
  });

  it("applies exclude after include", () => {
    const scope = { include: ["docs"], exclude: ["docs__private"] };

    expect(isManaged({ id: "docs__public", scope })).toBe(true);
    expect(isManaged({ id: "docs__private__secret", scope })).toBe(false);
  });
});

describe("describeScope", () => {
  it.each([
    [EMPTY_SCOPE, ""],
    [{ include: [], exclude: ["chain"] }, "Scope: excluding chain."],
    [{ include: ["a"], exclude: [] }, "Scope: only a."],
    [{ include: ["a"], exclude: ["b"] }, "Scope: only a; excluding b."],
  ])("describes %j", (scope, expected) => {
    expect(describeScope(scope)).toBe(expected);
  });
});

describe("MarkdownReader honours the scope", () => {
  let docsDir: string;

  const scoped = () => new MarkdownReader(docsDir, { include: [], exclude: ["chain"] });

  beforeEach(async () => {
    docsDir = await fs.mkdtemp(path.join(os.tmpdir(), "document-scope-"));
    await fs.mkdir(path.join(docsDir, "chain", "adr"), { recursive: true });
    await fs.writeFile(
      path.join(docsDir, "mine.md"),
      "---\ndescription: mine\nrelatedDocs:\n  - chain__adr__x\n---\n\n# Mine",
      "utf-8"
    );
    await fs.writeFile(
      path.join(docsDir, "chain", "adr", "x.md"),
      "---\nid: x\ntype: adr\nrequires: y\n---\n\n# Someone else's",
      "utf-8"
    );
  });

  afterEach(async () => {
    await fs.rm(docsDir, { recursive: true, force: true });
  });

  it("lists only what it manages", async () => {
    const { documents } = await scoped().listDocuments({ recursive: true });
    expect(documents.map((d) => d.id)).toEqual(["mine"]);
  });

  it("lists everything when unscoped", async () => {
    const { documents } = await new MarkdownReader(docsDir).listDocuments({ recursive: true });
    expect(documents.map((d) => d.id).sort()).toEqual(["chain__adr__x", "mine"]);
  });

  it.each([
    ["getDocumentContent", async (r: MarkdownReader) => expect(await r.getDocumentContent("chain__adr__x")).toBeNull()],
    ["documentExists", async (r: MarkdownReader) => expect(await r.documentExists("chain__adr__x")).toBe(false)],
  ])("treats an unmanaged document as absent: %s", async (_label, check) => {
    await check(scoped());
  });

  it.each([
    ["addDocument", (r: MarkdownReader) => r.addDocument({ id: "chain__adr__new", content: "# x\n\nbody" })],
    ["updateDocument", (r: MarkdownReader) => r.updateDocument({ id: "chain__adr__x", content: "# x\n\nbody" })],
    ["deleteDocument", (r: MarkdownReader) => r.deleteDocument("chain__adr__x")],
    ["renameDocument", (r: MarkdownReader) => r.renameDocument({ oldId: "chain__adr__x", newId: "mine2" })],
  ])("refuses to write outside the scope: %s", async (_label, write) => {
    const result = await write(scoped());

    // Refused with a reason, not silently ignored: doing nothing quietly would
    // look like success.
    expect(result.success).toBe(false);
    expect(result.error).toContain("Outside this server's scope");
  });

  it("leaves the other tool's file untouched when a write is refused", async () => {
    const before = await fs.readFile(path.join(docsDir, "chain", "adr", "x.md"), "utf-8");

    await scoped().deleteDocument("chain__adr__x");

    expect(await fs.readFile(path.join(docsDir, "chain", "adr", "x.md"), "utf-8")).toBe(before);
  });

  it("still writes inside the scope", async () => {
    const result = await scoped().addDocument({ id: "fresh", content: "# Fresh\n\nA new document." });
    expect(result.success).toBe(true);
  });
});
