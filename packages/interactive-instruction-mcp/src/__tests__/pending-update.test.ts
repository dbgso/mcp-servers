import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  savePendingUpdate,
  getPendingUpdate,
  deletePendingUpdate,
  listPendingUpdates,
} from "../utils/pending-update.js";

describe("pending-update", () => {
  const pendingDir = path.join(os.tmpdir(), "mcp-instruction-pending");

  beforeEach(async () => {
    // Clean up pending directory
    try {
      const files = await fs.readdir(pendingDir);
      for (const file of files) {
        await fs.unlink(path.join(pendingDir, file));
      }
    } catch {
      // Directory may not exist
    }
  });

  afterEach(async () => {
    // Clean up after tests
    try {
      const files = await fs.readdir(pendingDir);
      for (const file of files) {
        await fs.unlink(path.join(pendingDir, file));
      }
    } catch {
      // Ignore errors
    }
  });

  describe("savePendingUpdate", () => {
    it("saves pending update to file", async () => {
      const filePath = await savePendingUpdate({
        id: "test-doc",
        content: "# Test\n\nContent",
        originalPath: "/path/to/test-doc.md",
        diffPath: "/tmp/diffs/test-doc.diff",
      });

      expect(filePath).toContain("test-doc.json");

      const data = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(data);
      expect(parsed.id).toBe("test-doc");
      expect(parsed.content).toBe("# Test\n\nContent");
      expect(parsed.timestamp).toBeDefined();
    });

    it("sanitizes id for filename", async () => {
      const filePath = await savePendingUpdate({
        id: "test__doc/special",
        content: "content",
        originalPath: "/path/to/doc.md",
        diffPath: "/tmp/diffs/doc.diff",
      });

      expect(filePath).toContain("test__doc_special.json");
    });
  });

  describe("getPendingUpdate", () => {
    it("returns pending update when exists", async () => {
      await savePendingUpdate({
        id: "get-test",
        content: "content",
        originalPath: "/path/to/doc.md",
        diffPath: "/tmp/diffs/doc.diff",
      });

      const result = await getPendingUpdate("get-test");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("get-test");
      expect(result?.content).toBe("content");
    });

    it("returns null when not exists", async () => {
      const result = await getPendingUpdate("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("deletePendingUpdate", () => {
    it("deletes pending update and returns true", async () => {
      await savePendingUpdate({
        id: "delete-test",
        content: "content",
        originalPath: "/path/to/doc.md",
        diffPath: "/tmp/diffs/doc.diff",
      });

      const result = await deletePendingUpdate("delete-test");
      expect(result).toBe(true);

      const pending = await getPendingUpdate("delete-test");
      expect(pending).toBeNull();
    });

    it("returns false when file does not exist", async () => {
      const result = await deletePendingUpdate("nonexistent-delete-test");
      expect(result).toBe(false);
    });
  });

  describe("listPendingUpdates", () => {
    it("returns empty array when no pending updates", async () => {
      const result = await listPendingUpdates();
      expect(result).toEqual([]);
    });

    it("returns all pending updates sorted by timestamp", async () => {
      await savePendingUpdate({
        id: "list-test-1",
        content: "content 1",
        originalPath: "/path/1.md",
        diffPath: "/tmp/1.diff",
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await savePendingUpdate({
        id: "list-test-2",
        content: "content 2",
        originalPath: "/path/2.md",
        diffPath: "/tmp/2.diff",
      });

      const result = await listPendingUpdates();
      expect(result).toHaveLength(2);
      // Sorted by timestamp descending (newest first)
      expect(result[0].id).toBe("list-test-2");
      expect(result[1].id).toBe("list-test-1");
    });

    it("only reads .json files", async () => {
      await savePendingUpdate({
        id: "json-test",
        content: "content",
        originalPath: "/path/to/doc.md",
        diffPath: "/tmp/doc.diff",
      });

      // Create a non-json file
      await fs.writeFile(path.join(pendingDir, "not-json.txt"), "text");

      const result = await listPendingUpdates();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("json-test");
    });
  });
});
