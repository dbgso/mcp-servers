/**
 * Containment of document ids.
 *
 * `__` is the hierarchy separator, so an id is an untrusted path fragment and
 * `..__..__home__.claude__CLAUDE` used to resolve straight out of the documents
 * directory. The `update` -> `apply` route asks for no approval token, so that
 * was an unapproved overwrite of any `.md` file the process could reach.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  checkDocumentId,
  resolveDocumentPath,
  resolveDocumentPathOrThrow,
  DocumentIdError,
} from "../services/document-id.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import { UpdateHandler } from "../tools/instruction/handlers/update.js";
import { ApplyHandler } from "../tools/instruction/handlers/apply.js";
import { AddHandler } from "../tools/instruction/handlers/add.js";

const ROOT = "/srv/docs";

describe("checkDocumentId", () => {
  it.each([
    ["parent traversal", "..__home__.claude__CLAUDE"],
    ["traversal in the middle", "notes__..__..__escaped"],
    ["a lone parent segment", ".."],
    ["a current-dir segment", "."],
    ["a forward slash", "a/b"],
    ["a backslash", "a\\b"],
    ["a leading slash", "/etc__passwd"],
    ["a null byte", "a\0b"],
    ["empty", ""],
    ["whitespace only", "   "],
    ["a leading separator", "__leading"],
    ["a trailing separator", "trailing__"],
  ])("rejects %s", (_label, id) => {
    expect(checkDocumentId(id).ok).toBe(false);
  });

  it.each([
    ["a plain id", "coding-style"],
    ["a hierarchical id", "git__workflow"],
    ["a draft id", "_mcp_drafts__coding__testing"],
    ["a deep id", "a__b__c__d"],
    ["a non-ascii id", "設計"],
    ["a dotted name", "release.notes"],
    // Splits to ["a", "_b"] -- a file named `_b.md` under `a/`, unambiguous.
    ["a tripled separator", "a___b"],
  ])("accepts %s", (_label, id) => {
    expect(checkDocumentId(id).ok).toBe(true);
  });
});

describe("resolveDocumentPath", () => {
  it("maps the hierarchy separator to directories", () => {
    const result = resolveDocumentPath({ directory: ROOT, id: "git__workflow" });
    expect(result).toEqual({ ok: true, path: path.join(ROOT, "git", "workflow.md") });
  });

  it.each([
    ["..__..__etc__passwd"],
    ["notes__..__..__..__escaped"],
    ["..__sibling"],
  ])("refuses to resolve %s outside the directory", (id) => {
    const result = resolveDocumentPath({ directory: ROOT, id });
    expect(result.ok).toBe(false);
  });

  it("keeps every resolved path under the directory", () => {
    const result = resolveDocumentPath({ directory: ROOT, id: "a__b__c" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path.startsWith(path.resolve(ROOT) + path.sep)).toBe(true);
    }
  });

  it("throws a DocumentIdError from the throwing variant", () => {
    expect(() => resolveDocumentPathOrThrow({ directory: ROOT, id: "..__escape" })).toThrow(
      DocumentIdError
    );
  });
});

describe("handlers refuse to escape the documents directory", () => {
  let tempDir: string;
  let docsDir: string;
  let outsideFile: string;
  let reader: MarkdownReader;

  const OUTSIDE_CONTENT = "# Someone else's file\n\nDo not touch.";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "document-id-test-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(path.join(docsDir, "_mcp_drafts"), { recursive: true });

    outsideFile = path.join(tempDir, "CLAUDE.md");
    await fs.writeFile(outsideFile, OUTSIDE_CONTENT, "utf-8");

    reader = new MarkdownReader(docsDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("update does not stage a write to a file outside the docs directory", async () => {
    const result = await new UpdateHandler().execute({
      rawParams: { action: "update", id: "..__CLAUDE", content: "# Pwned" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(await fs.readFile(outsideFile, "utf-8")).toBe(OUTSIDE_CONTENT);
  });

  it("apply cannot complete a staged escape", async () => {
    await new UpdateHandler().execute({
      rawParams: { action: "update", id: "..__CLAUDE", content: "# Pwned" },
      context: { reader },
    });

    const result = await new ApplyHandler().execute({
      rawParams: { action: "apply", id: "..__CLAUDE" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(await fs.readFile(outsideFile, "utf-8")).toBe(OUTSIDE_CONTENT);
  });

  it("add reports the reason instead of writing outside", async () => {
    const result = await new AddHandler().execute({
      rawParams: {
        action: "add",
        id: "..__..__escaped",
        content: "# Escaped",
        description: "d",
        whenToUse: ["w"],
      },
      context: { reader },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === "text" && result.content[0].text).toMatch(/Invalid document ID/);

    const leaked = path.join(path.dirname(tempDir), "escaped.md");
    await expect(fs.access(leaked)).rejects.toThrow();
  });

  it("still writes ordinary hierarchical documents", async () => {
    const result = await new AddHandler().execute({
      rawParams: {
        action: "add",
        id: "coding__testing",
        content: "# Testing",
        description: "d",
        whenToUse: ["w"],
      },
      context: { reader },
    });

    expect(result.isError).toBeFalsy();
    const written = path.join(docsDir, "_mcp_drafts", "coding", "testing.md");
    expect(await fs.readFile(written, "utf-8")).toContain("# Testing");
  });
});
