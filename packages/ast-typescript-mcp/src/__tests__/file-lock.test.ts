import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireFileLock,
  releaseFileLock,
  isFileLocked,
  clearAllLocks,
} from "../utils/file-lock.js";

describe("file-lock", () => {
  beforeEach(() => {
    clearAllLocks();
  });

  describe("acquireFileLock", () => {
    it("should acquire lock on unlocked file", () => {
      const result = acquireFileLock({
        filePath: "/test/file.ts",
        toolName: "transform_signature",
        line: 10,
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should fail to acquire lock on already locked file", () => {
      acquireFileLock({
        filePath: "/test/file.ts",
        toolName: "transform_signature",
        line: 10,
      });

      const result = acquireFileLock({
        filePath: "/test/file.ts",
        toolName: "transform_call_site",
        line: 20,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("currently being modified");
      expect(result.error).toContain("transform_signature");
      expect(result.error).toContain("line 10");
      expect(result.error).toContain("batch_execute");
    });

    it("should allow lock on different files", () => {
      const result1 = acquireFileLock({
        filePath: "/test/file1.ts",
        toolName: "transform_signature",
      });

      const result2 = acquireFileLock({
        filePath: "/test/file2.ts",
        toolName: "transform_signature",
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });

  describe("releaseFileLock", () => {
    it("should release lock allowing re-acquisition", () => {
      acquireFileLock({
        filePath: "/test/file.ts",
        toolName: "transform_signature",
      });

      releaseFileLock({ filePath: "/test/file.ts" });

      const result = acquireFileLock({
        filePath: "/test/file.ts",
        toolName: "transform_call_site",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("isFileLocked", () => {
    it("should return false for unlocked file", () => {
      expect(isFileLocked({ filePath: "/test/file.ts" })).toBe(false);
    });

    it("should return true for locked file", () => {
      acquireFileLock({
        filePath: "/test/file.ts",
        toolName: "transform_signature",
      });

      expect(isFileLocked({ filePath: "/test/file.ts" })).toBe(true);
    });

    it("should return false after release", () => {
      acquireFileLock({
        filePath: "/test/file.ts",
        toolName: "transform_signature",
      });

      releaseFileLock({ filePath: "/test/file.ts" });

      expect(isFileLocked({ filePath: "/test/file.ts" })).toBe(false);
    });
  });

  describe("error message quality", () => {
    it("should provide actionable error message", () => {
      acquireFileLock({
        filePath: "/path/to/my-file.ts",
        toolName: "transform_signature",
        line: 42,
      });

      const result = acquireFileLock({
        filePath: "/path/to/my-file.ts",
        toolName: "transform_call_site",
        line: 100,
      });

      expect(result.success).toBe(false);
      // Error should mention the file
      expect(result.error).toContain("/path/to/my-file.ts");
      // Error should mention the blocking tool
      expect(result.error).toContain("transform_signature");
      // Error should mention the line number
      expect(result.error).toContain("line 42");
      // Error should suggest the solution
      expect(result.error).toContain("batch_execute");
      // Error should explain the problem
      expect(result.error).toContain("line number shifts");
    });
  });
});
