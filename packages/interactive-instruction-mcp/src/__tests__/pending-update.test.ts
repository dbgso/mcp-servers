import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  savePendingUpdate,
  getPendingUpdate,
  deletePendingUpdate,
  listPendingUpdates,
  PENDING_TTL_MS,
} from "../utils/pending-update.js";

describe("pending-update", () => {
  // Two documents directories, because the store used to be one shared tmp dir
  // for every server on the machine.
  let docsDir: string;
  let otherDocsDir: string;
  let savedOverride: string | undefined;

  const base = {
    content: "# Test\n\nContent",
    originalContent: "# Test\n\nOriginal",
    originalPath: "/path/to/test-doc.md",
    diffPath: "/tmp/diffs/test-doc.diff",
  };

  beforeEach(async () => {
    docsDir = await fs.mkdtemp(path.join(os.tmpdir(), "pending-docs-"));
    otherDocsDir = await fs.mkdtemp(path.join(os.tmpdir(), "pending-other-docs-"));
    // These tests are about the scoping itself, so the worker-isolation
    // override has to be out of the way.
    savedOverride = process.env.MCP_INSTRUCTION_PENDING_DIR;
    delete process.env.MCP_INSTRUCTION_PENDING_DIR;
  });

  afterEach(async () => {
    for (const dir of [docsDir, otherDocsDir]) {
      const probe = await savePendingUpdate({ docsDir: dir, id: "__probe", ...base });
      await fs.rm(path.dirname(probe), { recursive: true, force: true });
      await fs.rm(dir, { recursive: true, force: true });
    }
    if (savedOverride === undefined) {
      delete process.env.MCP_INSTRUCTION_PENDING_DIR;
    } else {
      process.env.MCP_INSTRUCTION_PENDING_DIR = savedOverride;
    }
  });

  describe("savePendingUpdate", () => {
    it("saves pending update to file", async () => {
      const filePath = await savePendingUpdate({ docsDir, id: "test-doc", ...base });

      expect(filePath).toContain("test-doc.json");

      const parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
      expect(parsed.id).toBe("test-doc");
      expect(parsed.content).toBe(base.content);
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.originalHash).toBeDefined();
    });

    it.each([
      ["a path separator", "test__doc/special"],
      ["non-ascii", "設計"],
      ["punctuation", "release@2.0!"],
    ])("keeps %s ids distinct instead of collapsing them", async (_label, id) => {
      const other = `${id}-other`;
      const a = await savePendingUpdate({ docsDir, id, ...base });
      const b = await savePendingUpdate({ docsDir, id: other, ...base });
      expect(a).not.toBe(b);

      // The old scheme replaced every character outside [a-zA-Z0-9_-], so two
      // Japanese ids became one file and one update silently overwrote the
      // other -- then `apply` reported success under the wrong id.
      expect((await getPendingUpdate({ docsDir, id }))?.id).toBe(id);
      expect((await getPendingUpdate({ docsDir, id: other }))?.id).toBe(other);
    });
  });

  describe("scoping by documents directory", () => {
    it("does not let one server read another's pending update", async () => {
      await savePendingUpdate({ docsDir, id: "overview", ...base, content: "A EDIT" });
      await savePendingUpdate({ docsDir: otherDocsDir, id: "overview", ...base, content: "B EDIT" });

      expect((await getPendingUpdate({ docsDir, id: "overview" }))?.content).toBe("A EDIT");
      expect((await getPendingUpdate({ docsDir: otherDocsDir, id: "overview" }))?.content).toBe(
        "B EDIT"
      );
    });

    it("lists only its own", async () => {
      await savePendingUpdate({ docsDir, id: "mine", ...base });
      await savePendingUpdate({ docsDir: otherDocsDir, id: "theirs", ...base });

      expect((await listPendingUpdates({ docsDir })).map((u) => u.id)).toEqual(["mine"]);
    });
  });

  describe("getPendingUpdate", () => {
    it("returns pending update when exists", async () => {
      await savePendingUpdate({ docsDir, id: "get-test", ...base });

      const result = await getPendingUpdate({ docsDir, id: "get-test" });
      expect(result?.id).toBe("get-test");
      expect(result?.content).toBe(base.content);
    });

    it("returns null when not exists", async () => {
      expect(await getPendingUpdate({ docsDir, id: "nonexistent" })).toBeNull();
    });

    it("ignores an update older than the TTL", async () => {
      const filePath = await savePendingUpdate({ docsDir, id: "stale", ...base });
      const record = JSON.parse(await fs.readFile(filePath, "utf-8"));
      record.timestamp = Date.now() - PENDING_TTL_MS - 1;
      await fs.writeFile(filePath, JSON.stringify(record), "utf-8");

      expect(await getPendingUpdate({ docsDir, id: "stale" })).toBeNull();
      expect(await listPendingUpdates({ docsDir })).toEqual([]);
    });
  });

  describe("deletePendingUpdate", () => {
    it("deletes pending update and returns true", async () => {
      await savePendingUpdate({ docsDir, id: "delete-test", ...base });

      expect(await deletePendingUpdate({ docsDir, id: "delete-test" })).toBe(true);
      expect(await getPendingUpdate({ docsDir, id: "delete-test" })).toBeNull();
    });

    it("returns false when file does not exist", async () => {
      expect(await deletePendingUpdate({ docsDir, id: "nonexistent-delete-test" })).toBe(false);
    });
  });

  describe("listPendingUpdates", () => {
    it("returns empty array when no pending updates", async () => {
      expect(await listPendingUpdates({ docsDir })).toEqual([]);
    });

    it("returns all pending updates sorted by timestamp", async () => {
      await savePendingUpdate({ docsDir, id: "list-test-1", ...base });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await savePendingUpdate({ docsDir, id: "list-test-2", ...base });

      const result = await listPendingUpdates({ docsDir });
      expect(result.map((u) => u.id)).toEqual(["list-test-2", "list-test-1"]);
    });

    it("skips files it did not write", async () => {
      const written = await savePendingUpdate({ docsDir, id: "json-test", ...base });
      const dir = path.dirname(written);
      await fs.writeFile(path.join(dir, "not-json.txt"), "text");
      await fs.writeFile(path.join(dir, "broken.json"), "{not json");

      const result = await listPendingUpdates({ docsDir });
      expect(result.map((u) => u.id)).toEqual(["json-test"]);
    });
  });
});
