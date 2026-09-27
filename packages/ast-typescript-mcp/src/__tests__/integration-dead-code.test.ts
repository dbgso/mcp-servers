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
  describe("TypeScriptHandler - Find Dead Code", () => {
    let handler: TypeScriptHandler;
    const DEAD_CODE_DIR = join(FIXTURES_DIR, "dead-code");

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should detect unused exports", async () => {
      // Include tests since fixtures are under __tests__ directory
      const result = await handler.findDeadCode({
        paths: [DEAD_CODE_DIR],
        includeTests: true,
      });

      expect(result.filesAnalyzed).toBeGreaterThan(0);
      expect(result.exportsChecked).toBeGreaterThan(0);

      // Find dead exports from unused-export.ts
      const unusedExportSymbols = result.deadSymbols.filter(
        (s) => s.filePath.includes("unused-export.ts") && s.kind === "export"
      );

      // unusedFunction, UnusedClass, UNUSED_CONSTANT, UnusedInterface, UnusedType should be detected
      const deadNames = unusedExportSymbols.map((s) => s.name);
      expect(deadNames).toContain("unusedFunction");
      expect(deadNames).toContain("UnusedClass");
      expect(deadNames).toContain("UNUSED_CONSTANT");
      expect(deadNames).toContain("UnusedInterface");
      expect(deadNames).toContain("UnusedType");
    });

    it("should not flag used exports as dead", async () => {
      const result = await handler.findDeadCode({
        paths: [DEAD_CODE_DIR],
        includeTests: true,
      });

      // Exports from used-export.ts should NOT be in dead symbols
      // because they are imported by consumer.ts
      const usedExportDeadSymbols = result.deadSymbols.filter(
        (s) => s.filePath.includes("used-export.ts") && s.kind === "export"
      );

      const deadNames = usedExportDeadSymbols.map((s) => s.name);
      // These should be imported and thus not dead
      expect(deadNames).not.toContain("usedFunction");
      expect(deadNames).not.toContain("UsedClass");
      expect(deadNames).not.toContain("USED_CONSTANT");
    });

    it("should detect unused private members", async () => {
      const result = await handler.findDeadCode({
        paths: [DEAD_CODE_DIR],
        includeTests: true,
      });

      expect(result.privateMembersChecked).toBeGreaterThan(0);

      // Find dead private members from private-members.ts
      const privateDeadSymbols = result.deadSymbols.filter(
        (s) => s.filePath.includes("private-members.ts") && s.kind === "private_member"
      );

      const deadNames = privateDeadSymbols.map((s) => s.name);

      // unusedMethod and unusedProperty should be detected as dead
      expect(deadNames).toContain("unusedMethod");
      expect(deadNames).toContain("unusedProperty");

      // usedMethod and usedProperty should NOT be dead (they are used)
      expect(deadNames).not.toContain("usedMethod");
      expect(deadNames).not.toContain("usedProperty");
    });

    it("should exclude entry point exports", async () => {
      const result = await handler.findDeadCode({
        paths: [DEAD_CODE_DIR],
        includeTests: true,
        entryPoints: ["**/entry-point.ts"],
      });

      // Exports from entry-point.ts should not be in dead symbols
      const entryPointDeadSymbols = result.deadSymbols.filter(
        (s) => s.filePath.includes("entry-point.ts")
      );

      expect(entryPointDeadSymbols).toHaveLength(0);
    });

    it("should analyze single file", async () => {
      const filePath = join(DEAD_CODE_DIR, "private-members.ts");
      const result = await handler.findDeadCode({
        paths: [filePath],
        includeTests: true,
      });

      expect(result.filesAnalyzed).toBe(1);
      expect(result.privateMembersChecked).toBeGreaterThan(0);
    });

    it("should handle empty paths", async () => {
      const result = await handler.findDeadCode({
        paths: [],
      });

      expect(result.filesAnalyzed).toBe(0);
      expect(result.exportsChecked).toBe(0);
      expect(result.privateMembersChecked).toBe(0);
      expect(result.deadSymbols).toHaveLength(0);
    });

    it("should only check exports when scope='exports'", async () => {
      const result = await handler.findDeadCode({
        paths: [DEAD_CODE_DIR],
        includeTests: true,
        scope: "exports",
      });

      // Should check exports but not private members
      expect(result.exportsChecked).toBeGreaterThan(0);
      expect(result.privateMembersChecked).toBe(0);

      // Should find dead exports
      const deadExports = result.deadSymbols.filter((s) => s.kind === "export");
      expect(deadExports.length).toBeGreaterThan(0);

      // Should NOT find any private_member kinds
      const deadPrivates = result.deadSymbols.filter((s) => s.kind === "private_member");
      expect(deadPrivates).toHaveLength(0);
    });

    it("should only check private members when scope='private_members'", async () => {
      const result = await handler.findDeadCode({
        paths: [DEAD_CODE_DIR],
        includeTests: true,
        scope: "private_members",
      });

      // Should check private members but not exports
      expect(result.exportsChecked).toBe(0);
      expect(result.privateMembersChecked).toBeGreaterThan(0);

      // Should find dead private members
      const deadPrivates = result.deadSymbols.filter((s) => s.kind === "private_member");
      expect(deadPrivates.length).toBeGreaterThan(0);

      // Should NOT find any export kinds
      const deadExports = result.deadSymbols.filter((s) => s.kind === "export");
      expect(deadExports).toHaveLength(0);
    });

    it("reference_scope='paths' should cause false positives for cross-file usage", async () => {
      // Only analyze used-export.ts but NOT consumer.ts
      const usedExportFile = join(DEAD_CODE_DIR, "used-export.ts");
      const result = await handler.findDeadCode({
        paths: [usedExportFile],
        includeTests: true,
        referenceScope: "paths", // Only check within the single file
      });

      // With reference_scope="paths", exports appear dead because consumer.ts is not in paths
      const deadNames = result.deadSymbols.map((s) => s.name);
      expect(deadNames).toContain("usedFunction");
      expect(deadNames).toContain("UsedClass");
      expect(deadNames).toContain("USED_CONSTANT");
    });

    it("reference_scope='project' should avoid false positives for cross-file usage", async () => {
      // Only analyze used-export.ts but NOT consumer.ts
      const usedExportFile = join(DEAD_CODE_DIR, "used-export.ts");
      const result = await handler.findDeadCode({
        paths: [usedExportFile],
        includeTests: true,
        referenceScope: "project", // Check across the entire project
      });

      // With reference_scope="project", consumer.ts is found and exports are NOT dead
      const deadNames = result.deadSymbols.map((s) => s.name);
      expect(deadNames).not.toContain("usedFunction");
      expect(deadNames).not.toContain("UsedClass");
      expect(deadNames).not.toContain("USED_CONSTANT");
    });

    it("default reference_scope should be 'project' (avoids false positives)", async () => {
      // Only analyze used-export.ts, do NOT specify referenceScope
      const usedExportFile = join(DEAD_CODE_DIR, "used-export.ts");
      const result = await handler.findDeadCode({
        paths: [usedExportFile],
        includeTests: true,
        // referenceScope not specified - should default to "project"
      });

      // Default behavior should check entire project, so no false positives
      const deadNames = result.deadSymbols.map((s) => s.name);
      expect(deadNames).not.toContain("usedFunction");
      expect(deadNames).not.toContain("UsedClass");
      expect(deadNames).not.toContain("USED_CONSTANT");
    });
  });

});
