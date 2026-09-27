import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { TypeScriptHandler } from "../handlers/typescript.js";
import { parseArgs, findTsConfig, resolveToSourcePath } from "../config.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");


/**
 * Part of what was one 1861-line `integration.test.ts`.
 *
 * Split because `--shard` divides a package's files by size, so the biggest file
 * decides which shard is the slowest one: measured, this file's original was 66s
 * of a shard that took 113s while the other two took 23s and 28s. A file cannot
 * be split across shards, so the only way to balance was to make it several.
 *
 * The outer `describe("Integration Tests")` is kept in each part, so every test
 * keeps the name it had and the split is invisible to anything reading results.
 */
describe("Integration Tests", () => {
  describe("TypeScriptHandler - Find References", () => {
    let handler: TypeScriptHandler;

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should find references to an exported function", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      // Line 3: export function createUser(id: UserId, name: string, email: string): User {
      // createUser starts at column 17
      const result = await handler.findReferences({ filePath: filePath, line: 3, column: 17 });

      expect(result.symbolName).toBe("createUser");
      expect(result.references.length).toBeGreaterThan(0);

      // Should find reference in main.ts
      const mainRef = result.references.find((r) => r.filePath.includes("main.ts"));
      expect(mainRef).toBeDefined();
    });

    it("should find references to an exported class", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      // Line 13: export class UserService {
      // UserService starts at column 14
      const result = await handler.findReferences({ filePath: filePath, line: 13, column: 14 });

      expect(result.symbolName).toBe("UserService");
      expect(result.references.length).toBeGreaterThan(0);

      // Should find reference in main.ts
      const mainRef = result.references.find((r) => r.filePath.includes("main.ts"));
      expect(mainRef).toBeDefined();
      expect(mainRef?.context).toMatch(/import|new/);
    });

    it("should find references to an exported interface", async () => {
      const filePath = join(FIXTURES_DIR, "types.ts");
      // Line 1: export interface User {
      // User starts at column 18
      const result = await handler.findReferences({ filePath: filePath, line: 1, column: 18 });

      expect(result.symbolName).toBe("User");
      expect(result.references.length).toBeGreaterThan(0);

      // Should find references in utils.ts and main.ts
      const utilsRef = result.references.find((r) => r.filePath.includes("utils.ts"));
      const mainRef = result.references.find((r) => r.filePath.includes("main.ts"));

      expect(utilsRef).toBeDefined();
      expect(mainRef).toBeDefined();
    });

    it("should return empty references for non-identifier position", async () => {
      const filePath = join(FIXTURES_DIR, "types.ts");
      // Position on whitespace
      const result = await handler.findReferences({ filePath: filePath, line: 1, column: 1 });

      expect(result.symbolName).toBe("");
      expect(result.references).toEqual([]);
    });

    it("should identify reference context correctly", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      // createUser function
      const result = await handler.findReferences({ filePath: filePath, line: 3, column: 17 });

      // Find call context in main.ts (line 12: createUser(...))
      const callRef = result.references.find(
        (r) => r.filePath.includes("main.ts") && r.context === "call"
      );

      // Find import context in main.ts (line 1: import { createUser, ... })
      const importRef = result.references.find(
        (r) => r.filePath.includes("main.ts") && r.context === "import"
      );

      // At least one of these should exist
      expect(callRef || importRef).toBeDefined();
    });

    it("should find references within the same file (this.method calls)", async () => {
      const filePath = join(FIXTURES_DIR, "same-file-refs.ts");
      // Line 4: add(a: number, b: number): number {
      // add starts at column 3
      const result = await handler.findReferences({ filePath: filePath, line: 4, column: 3 });

      expect(result.symbolName).toBe("add");

      // Should find this.add() calls within the same file
      const sameFileRefs = result.references.filter((r) =>
        r.filePath.includes("same-file-refs.ts")
      );

      // There are 3 this.add() calls + 1 calc.add() call in the same file
      expect(sameFileRefs.length).toBeGreaterThanOrEqual(3);

      // Verify specific lines where this.add is called
      const lines = sameFileRefs.map((r) => r.line);
      expect(lines).toContain(10); // this.add(this.add(a, b), c)
      expect(lines).toContain(15); // this.add(n, n)
      expect(lines).toContain(21); // calc.add(1, 2)
    });

    it("should find references to inherited methods", async () => {
      const basePath = join(FIXTURES_DIR, "inherited-method/base.ts");
      // Line 10: performUniqueAction(rawParams: unknown, context: string): string {
      // performUniqueAction starts at column 3
      const result = await handler.findReferences({ filePath: basePath, line: 10, column: 3 });

      expect(result.symbolName).toBe("performUniqueAction");

      // Should find handler.performUniqueAction() call in child.ts
      const childRefs = result.references.filter((r) =>
        r.filePath.includes("child.ts")
      );

      // There is 1 handler.performUniqueAction() call in child.ts at line 10
      expect(childRefs.length).toBeGreaterThanOrEqual(1);
      expect(childRefs.some((r) => r.line === 10)).toBe(true);
    });
  });

});
