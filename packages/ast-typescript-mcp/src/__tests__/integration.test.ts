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
  describe("TypeScriptHandler - Basic Operations", () => {
    let handler: TypeScriptHandler;

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should read a TypeScript file and return structure", async () => {
      const filePath = join(FIXTURES_DIR, "types.ts");
      const result = await handler.read(filePath);

      expect(result.filePath).toBe(filePath);
      expect(result.fileType).toBe("typescript");
      expect(result.structure).toBeDefined();
      expect(result.structure.statements).toBeDefined();
    });

    it("should query summary of declarations", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      const result = await handler.query({ filePath: filePath, queryType: "summary" });

      expect(result.query).toBe("summary");
      expect(Array.isArray(result.data)).toBe(true);

      const summaries = result.data as Array<{ kind: string; name: string }>;
      const names = summaries.map((s) => s.name);

      expect(names).toContain("createUser");
      expect(names).toContain("getUserById");
      expect(names).toContain("DEFAULT_TIMEOUT");
      expect(names).toContain("UserService");
    });

    it("should query imports", async () => {
      const filePath = join(FIXTURES_DIR, "main.ts");
      const result = await handler.query({ filePath: filePath, queryType: "imports" });

      expect(result.query).toBe("imports");
      expect(Array.isArray(result.data)).toBe(true);

      const imports = result.data as Array<{ module: string; namedImports: string[] }>;
      const utilsImport = imports.find((i) => i.module === "./utils.js");

      expect(utilsImport).toBeDefined();
      expect(utilsImport?.namedImports).toContain("createUser");
      expect(utilsImport?.namedImports).toContain("UserService");
    });

    it("should query exports", async () => {
      const filePath = join(FIXTURES_DIR, "types.ts");
      const result = await handler.query({ filePath: filePath, queryType: "exports" });

      expect(result.query).toBe("exports");
      expect(Array.isArray(result.data)).toBe(true);

      const exports = result.data as Array<{ name: string; kind: string }>;
      const names = exports.map((e) => e.name);

      expect(names).toContain("User");
      expect(names).toContain("UserId");
      expect(names).toContain("Config");
    });

    it("should get declaration by name", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      const result = await handler.query({ filePath: filePath, queryType: "full", options: { name: "createUser" } });

      expect(result.data).toBeDefined();
      expect(result.data).not.toBeNull();
    });
  });

  describe("TypeScriptHandler - Go to Definition", () => {
    let handler: TypeScriptHandler;

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should find definition of imported function", async () => {
      const filePath = join(FIXTURES_DIR, "main.ts");
      // Line 1: import { createUser, UserService, DEFAULT_TIMEOUT } from "./utils.js";
      // createUser starts around column 10
      const result = await handler.goToDefinition({ filePath: filePath, line: 1, column: 10 });

      expect(result.identifier).toBe("createUser");
      expect(result.definitions.length).toBeGreaterThan(0);

      const def = result.definitions[0];
      expect(def.name).toBe("createUser");
      expect(def.filePath).toContain("utils.ts");
      expect(def.kind).toBeDefined();
    });

    it("should find definition of imported class", async () => {
      const filePath = join(FIXTURES_DIR, "main.ts");
      // Line 1: import { createUser, UserService, DEFAULT_TIMEOUT } from "./utils.js";
      // UserService starts around column 22
      const result = await handler.goToDefinition({ filePath: filePath, line: 1, column: 22 });

      expect(result.identifier).toBe("UserService");
      expect(result.definitions.length).toBeGreaterThan(0);

      const def = result.definitions[0];
      expect(def.name).toBe("UserService");
      expect(def.kind).toBeDefined();
    });

    it("should find definition of imported type", async () => {
      const filePath = join(FIXTURES_DIR, "main.ts");
      // Line 2: import type { User, Config } from "./types.js";
      // User starts around column 15
      const result = await handler.goToDefinition({ filePath: filePath, line: 2, column: 15 });

      expect(result.identifier).toBe("User");
      expect(result.definitions.length).toBeGreaterThan(0);

      const def = result.definitions[0];
      expect(def.name).toBe("User");
      expect(def.filePath).toContain("types.ts");
    });

    it("should find definition of local variable usage", async () => {
      const filePath = join(FIXTURES_DIR, "main.ts");
      // Line 12: const user: User = createUser(1, "Alice", "alice@example.com");
      // createUser call starts around column 22
      const result = await handler.goToDefinition({ filePath: filePath, line: 12, column: 22 });

      expect(result.definitions.length).toBeGreaterThan(0);
      const def = result.definitions[0];
      expect(def.filePath).toContain("utils.ts");
    });

    it("should return empty definitions for non-identifier position", async () => {
      const filePath = join(FIXTURES_DIR, "main.ts");
      // Line 4: const config: Config = {
      // Position on whitespace or operator
      const result = await handler.goToDefinition({ filePath: filePath, line: 4, column: 1 });

      // Should not crash, may have empty definitions
      expect(result.sourceFilePath).toBe(filePath);
    });
  });

  describe("TypeScriptHandler - Edge Cases", () => {
    let handler: TypeScriptHandler;

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should handle empty file", async () => {
      // Reading a file that exists but we query something that doesn't exist
      const filePath = join(FIXTURES_DIR, "types.ts");
      const result = await handler.query({ filePath: filePath, queryType: "full", options: { name: "NonExistentThing" } });

      expect(result.data).toBeNull();
    });

    it("should filter by kind in summary", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      const result = await handler.query({ filePath: filePath, queryType: "summary", options: { kind: "function" } });

      expect(Array.isArray(result.data)).toBe(true);
      const summaries = result.data as Array<{ kind: string }>;

      // All results should be functions
      for (const summary of summaries) {
        expect(summary.kind).toBe("function");
      }
    });

    it("should filter by class kind", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      const result = await handler.query({ filePath: filePath, queryType: "summary", options: { kind: "class" } });

      expect(Array.isArray(result.data)).toBe(true);
      const summaries = result.data as Array<{ kind: string; name: string }>;

      expect(summaries.length).toBe(1);
      expect(summaries[0].name).toBe("UserService");
    });

    it("should handle go to definition on class instantiation", async () => {
      const filePath = join(FIXTURES_DIR, "main.ts");
      // Line 10: const service = new UserService();
      // UserService starts around column 24
      const result = await handler.goToDefinition({ filePath: filePath, line: 10, column: 24 });

      expect(result.definitions.length).toBeGreaterThan(0);
    });
  });

  describe("TypeScriptHandler - Diff Structure", () => {
    let handler: TypeScriptHandler;

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should detect added declarations between two files", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.ts");
      const filePathB = join(FIXTURES_DIR, "diff-b.ts");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      expect(result.filePathA).toBe(filePathA);
      expect(result.filePathB).toBe(filePathB);
      expect(result.fileType).toBe("typescript");

      // NewFeature class and AdminUser interface should be added
      const addedNames = result.added.map((a) => a.key);
      expect(addedNames).toContain("NewFeature");
      expect(addedNames).toContain("AdminUser");
    });

    it("should detect removed declarations between two files", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.ts");
      const filePathB = join(FIXTURES_DIR, "diff-b.ts");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      // User interface and MAX_USERS variable should be removed
      const removedNames = result.removed.map((r) => r.key);
      expect(removedNames).toContain("User");
      expect(removedNames).toContain("MAX_USERS");
    });

    it("should detect modified declarations (kind change)", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.ts");
      const filePathB = join(FIXTURES_DIR, "diff-b.ts");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      // createUser changed from function to variable (arrow function)
      const modifiedNames = result.modified.map((m) => m.key);
      expect(modifiedNames).toContain("createUser");

      // Check that the kind change is detected
      const createUserMod = result.modified.find((m) => m.key === "createUser");
      expect(createUserMod?.details).toContain("kind:");
    });

    it("should include summary with counts", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.ts");
      const filePathB = join(FIXTURES_DIR, "diff-b.ts");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "summary" });

      expect(result.summary).toBeDefined();
      expect(typeof result.summary).toBe("string");
      // Summary should mention Added and/or Removed
      expect(result.summary).toMatch(/Added|Removed|Modified/);
    });

    it("should support detailed level with property changes", async () => {
      const filePathA = join(FIXTURES_DIR, "diff-a.ts");
      const filePathB = join(FIXTURES_DIR, "diff-b.ts");
      const result = await handler.diffStructure({ filePathA, filePathB, level: "detailed" });

      // In detailed mode, modifications should include line changes
      expect(result.modified.length).toBeGreaterThan(0);
      const mod = result.modified[0];
      expect(mod.lineA).toBeDefined();
      expect(mod.lineB).toBeDefined();
    });

    it("should report no changes when comparing same file", async () => {
      const filePath = join(FIXTURES_DIR, "types.ts");
      const result = await handler.diffStructure({
        filePathA: filePath,
        filePathB: filePath,
        level: "summary",
      });

      expect(result.added).toHaveLength(0);
      expect(result.removed).toHaveLength(0);
      expect(result.modified).toHaveLength(0);
      expect(result.summary).toBe("No changes");
    });
  });

  describe("TypeScriptHandler - Type Check", () => {
    let handler: TypeScriptHandler;

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should return no errors for valid TypeScript file", async () => {
      const filePath = join(FIXTURES_DIR, "types.ts");
      const result = await handler.typeCheck({ filePath });

      expect(result.filePath).toBe(filePath);
      expect(result.success).toBe(true);
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should detect type errors in invalid TypeScript file", async () => {
      const filePath = join(FIXTURES_DIR, "type-error.ts");
      const result = await handler.typeCheck({ filePath });

      expect(result.filePath).toBe(filePath);
      expect(result.success).toBe(false);
      expect(result.errorCount).toBeGreaterThan(0);

      // Check that diagnostics contain expected error information
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors.length).toBeGreaterThan(0);

      // Each error should have required fields
      for (const error of errors) {
        expect(error.message).toBeTruthy();
        expect(error.code).toBeGreaterThan(0);
        expect(error.line).toBeGreaterThan(0);
        expect(error.column).toBeGreaterThan(0);
        expect(error.filePath).toContain("type-error.ts");
      }
    });

    it("should include suggestion diagnostics when requested", async () => {
      const filePath = join(FIXTURES_DIR, "types.ts");
      const result = await handler.typeCheck({
        filePath,
        includeSuggestions: true,
      });

      expect(result.filePath).toBe(filePath);
      // suggestionCount might be 0 if no suggestions, but should be included in result
      expect(typeof result.suggestionCount).toBe("number");
    });

    it("should report correct line and column for errors", async () => {
      const filePath = join(FIXTURES_DIR, "type-error.ts");
      const result = await handler.typeCheck({ filePath });

      // Find the error about 'nme' property (should be on line 9)
      const nmeError = result.diagnostics.find(
        (d) => d.message.includes("nme") || d.message.includes("name")
      );
      expect(nmeError).toBeDefined();
      if (nmeError) {
        expect(nmeError.line).toBe(9);
      }
    });

    it("should include source text for errors", async () => {
      const filePath = join(FIXTURES_DIR, "type-error.ts");
      const result = await handler.typeCheck({ filePath });

      const errorsWithSource = result.diagnostics.filter((d) => d.sourceText);
      // At least some errors should have source text
      expect(errorsWithSource.length).toBeGreaterThan(0);
    });
  });

  describe("Config - Argument Parsing", () => {
    it("should parse --key=value arguments", () => {
      const config = parseArgs(["--tsConfigFilePath=/path/to/tsconfig.json"]);

      expect(config.projectOptions.tsConfigFilePath).toBe("/path/to/tsconfig.json");
    });

    it("should parse boolean --key arguments", () => {
      const config = parseArgs(["--skipAddingFilesFromTsConfig"]);

      expect(config.projectOptions.skipAddingFilesFromTsConfig).toBe(true);
    });

    it("should parse --no-key arguments", () => {
      const config = parseArgs(["--no-resolveToSource"]);

      expect(config.extendedOptions.resolveToSource).toBe(false);
    });

    it("should parse boolean string values", () => {
      const config = parseArgs(["--skipFileDependencyResolution=false"]);

      expect(config.projectOptions.skipFileDependencyResolution).toBe(false);
    });

    it("should parse numeric values", () => {
      const config = parseArgs(["--someNumber=42"]);

      expect((config.projectOptions as Record<string, unknown>).someNumber).toBe(42);
    });

    it("should merge multiple arguments", () => {
      const config = parseArgs([
        "--tsConfigFilePath=/custom/tsconfig.json",
        "--skipAddingFilesFromTsConfig=true",
        "--resolveToSource=false",
      ]);

      expect(config.projectOptions.tsConfigFilePath).toBe("/custom/tsconfig.json");
      expect(config.projectOptions.skipAddingFilesFromTsConfig).toBe(true);
      expect(config.extendedOptions.resolveToSource).toBe(false);
    });

    it("should use default values when no args provided", () => {
      const config = parseArgs([]);

      expect(config.projectOptions.skipAddingFilesFromTsConfig).toBe(true);
      expect(config.projectOptions.skipFileDependencyResolution).toBe(false);
      expect(config.extendedOptions.resolveToSource).toBe(true);
    });
  });

  describe("Config - tsconfig Discovery", () => {
    it("should find tsconfig.json in fixtures directory", () => {
      const filePath = join(FIXTURES_DIR, "main.ts");
      const tsconfig = findTsConfig(filePath);

      expect(tsconfig).toBeDefined();
      expect(tsconfig).toContain("fixtures");
      expect(tsconfig).toContain("tsconfig.json");
    });

    it("should find tsconfig.json in parent directory", () => {
      const filePath = join(FIXTURES_DIR, "mock-lib", "src", "helper.ts");
      const tsconfig = findTsConfig(filePath);

      // Should find fixtures/tsconfig.json (parent of mock-lib)
      expect(tsconfig).toBeDefined();
      expect(tsconfig).toContain("tsconfig.json");
    });

    it("should return undefined when no tsconfig found", () => {
      // Use root path where there's no tsconfig
      const tsconfig = findTsConfig("/tmp/nonexistent/file.ts");

      expect(tsconfig).toBeUndefined();
    });
  });

  describe("Config - resolveToSource", () => {
    it("should resolve dist path to src path", () => {
      const dtsPath = join(FIXTURES_DIR, "mock-lib", "dist", "helper.d.ts");
      const srcPath = resolveToSourcePath(dtsPath);

      expect(srcPath).toBeDefined();
      expect(srcPath).toContain("/src/");
      expect(srcPath).toContain("helper.ts");
      expect(srcPath).not.toContain(".d.ts");
    });

    it("should return null when source file does not exist", () => {
      const dtsPath = join(FIXTURES_DIR, "mock-lib", "dist", "nonexistent.d.ts");
      const srcPath = resolveToSourcePath(dtsPath);

      expect(srcPath).toBeNull();
    });

    it("should return null for non-dist paths", () => {
      const filePath = join(FIXTURES_DIR, "types.ts");
      const srcPath = resolveToSourcePath(filePath);

      expect(srcPath).toBeNull();
    });
  });

  describe("TypeScriptHandler with Config", () => {
    it("should use custom tsconfig when provided", async () => {
      const tsconfigPath = join(FIXTURES_DIR, "tsconfig.json");
      const handler = new TypeScriptHandler({
        projectOptions: {
          tsConfigFilePath: tsconfigPath,
          skipAddingFilesFromTsConfig: true,
        },
        extendedOptions: {
          resolveToSource: true,
        },
      });

      const filePath = join(FIXTURES_DIR, "main.ts");
      const result = await handler.read(filePath);

      expect(result.structure).toBeDefined();
    });

    it("should resolve .d.ts to .ts when resolveToSource is enabled", async () => {
      const handler = new TypeScriptHandler({
        projectOptions: {
          skipAddingFilesFromTsConfig: true,
        },
        extendedOptions: {
          resolveToSource: true,
        },
      });

      // This test verifies the resolveToSource logic
      // In a real scenario, we'd need to have the .d.ts file be the actual definition
      // For now, we just verify the handler is configured correctly
      expect(handler).toBeDefined();
    });

    it("should not resolve .d.ts when resolveToSource is disabled", async () => {
      const handler = new TypeScriptHandler({
        projectOptions: {
          skipAddingFilesFromTsConfig: true,
        },
        extendedOptions: {
          resolveToSource: false,
        },
      });

      expect(handler).toBeDefined();
    });
  });

});
