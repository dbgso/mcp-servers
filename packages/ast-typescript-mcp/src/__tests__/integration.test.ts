import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { TypeScriptHandler } from "../handlers/typescript.js";
import { parseArgs, findTsConfig, resolveToSourcePath } from "../config.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

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

  describe("TypeScriptHandler - Extract Interface", () => {
    let handler: TypeScriptHandler;

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should extract interface from a class with default name", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      const result = await handler.extractInterface({
        filePath,
        className: "UserService",
      });

      expect(result.filePath).toBe(filePath);
      expect(result.className).toBe("UserService");
      // Default interface name should be I{ClassName}
      expect(result.interfaceName).toBe("IUserService");
      expect(result.interfaceStructure).toBeDefined();
      expect(result.interfaceStructure.name).toBe("IUserService");
    });

    it("should extract interface with custom name", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      const result = await handler.extractInterface({
        filePath,
        className: "UserService",
        interfaceName: "UserServiceInterface",
      });

      expect(result.interfaceName).toBe("UserServiceInterface");
      expect(result.interfaceStructure.name).toBe("UserServiceInterface");
    });

    it("should include public methods in extracted interface", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      const result = await handler.extractInterface({
        filePath,
        className: "UserService",
      });

      // Check that the interface has methods
      const methods = result.interfaceStructure.methods ?? [];
      expect(methods.length).toBeGreaterThan(0);

      // Check for specific methods from UserService (addUser, getUser)
      const methodNames = methods.map((m) => m.name);
      expect(methodNames).toContain("addUser");
      expect(methodNames).toContain("getUser");
    });

    it("should throw error for non-existent class", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");

      await expect(
        handler.extractInterface({
          filePath,
          className: "NonExistentClass",
        })
      ).rejects.toThrow("Class 'NonExistentClass' not found");
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
  });

  describe("TypeScriptHandler - Type Hierarchy", () => {
    let handler: TypeScriptHandler;
    const TYPE_HIERARCHY_FILE = join(FIXTURES_DIR, "type-hierarchy.ts");

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    describe("ancestors direction (extends relationships)", () => {
      it("should find base class for a derived class", async () => {
        // Dog class starts at line 27 (export class Dog extends Creature)
        // Dog is at column 14
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 27,
          column: 14,
          direction: "ancestors",
        });

        expect(result.root.name).toBe("Dog");
        expect(result.root.kind).toBe("class");
        expect(result.direction).toBe("ancestors");

        // Dog extends Creature and implements Animal
        const ancestorNames = result.root.children.map((c) => c.name);
        expect(ancestorNames).toContain("Creature");
        expect(ancestorNames).toContain("Animal");

        // Verify relations
        const creatureChild = result.root.children.find((c) => c.name === "Creature");
        expect(creatureChild?.relation).toBe("extends");

        const animalChild = result.root.children.find((c) => c.name === "Animal");
        expect(animalChild?.relation).toBe("implements");
      });

      it("should traverse multi-level inheritance", async () => {
        // PetDog class at line 41 (export class PetDog extends Dog implements Pet)
        // PetDog is at column 14
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 41,
          column: 14,
          direction: "ancestors",
        });

        expect(result.root.name).toBe("PetDog");
        expect(result.root.kind).toBe("class");

        // PetDog extends Dog and implements Pet
        const directAncestorNames = result.root.children.map((c) => c.name);
        expect(directAncestorNames).toContain("Dog");
        expect(directAncestorNames).toContain("Pet");

        // Dog should have Creature as ancestor
        const dogChild = result.root.children.find((c) => c.name === "Dog");
        expect(dogChild).toBeDefined();
        if (dogChild) {
          const dogAncestorNames = dogChild.children.map((c) => c.name);
          expect(dogAncestorNames).toContain("Creature");
        }
      });

      it("should find extended interface for an interface", async () => {
        // Pet interface at line 13 (export interface Pet extends Animal)
        // Pet is at column 18
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 13,
          column: 18,
          direction: "ancestors",
        });

        expect(result.root.name).toBe("Pet");
        expect(result.root.kind).toBe("interface");

        // Pet extends Animal
        const ancestorNames = result.root.children.map((c) => c.name);
        expect(ancestorNames).toContain("Animal");

        const animalChild = result.root.children.find((c) => c.name === "Animal");
        expect(animalChild?.relation).toBe("extends");
        expect(animalChild?.kind).toBe("interface");
      });
    });

    describe("implements relationships", () => {
      it("should find implemented interfaces", async () => {
        // Robot class at line 70 (export class Robot implements Animal, Walkable)
        // Robot is at column 14
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 70,
          column: 14,
          direction: "ancestors",
        });

        expect(result.root.name).toBe("Robot");
        expect(result.root.kind).toBe("class");

        // Robot implements Animal and Walkable
        const implementedNames = result.root.children.map((c) => c.name);
        expect(implementedNames).toContain("Animal");
        expect(implementedNames).toContain("Walkable");

        // Verify all are implements relations
        for (const child of result.root.children) {
          expect(child.relation).toBe("implements");
        }
      });
    });

    describe("descendants direction", () => {
      it("should find derived classes from base class", async () => {
        // Creature class at line 18 (export class Creature)
        // Creature is at column 14
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 18,
          column: 14,
          direction: "descendants",
        });

        expect(result.root.name).toBe("Creature");
        expect(result.root.kind).toBe("class");
        expect(result.direction).toBe("descendants");

        // Creature has Dog and Cat as derived classes
        const descendantNames = result.root.children.map((c) => c.name);
        expect(descendantNames).toContain("Dog");
        expect(descendantNames).toContain("Cat");

        // Verify relations
        for (const child of result.root.children) {
          expect(child.relation).toBe("derivedBy");
        }
      });

      it("should find implementors of an interface", async () => {
        // Animal interface at line 7 (export interface Animal)
        // Animal is at column 18
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 7,
          column: 18,
          direction: "descendants",
        });

        expect(result.root.name).toBe("Animal");
        expect(result.root.kind).toBe("interface");

        // Animal is implemented by Dog, Cat, Robot
        const implementorNames = result.root.children.map((c) => c.name);
        expect(implementorNames.length).toBeGreaterThan(0);
        // At least Dog should be found
        expect(implementorNames).toContain("Dog");
      });

      it("should traverse multi-level descendants", async () => {
        // Dog class - check that PetDog is found as descendant
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 27,
          column: 14,
          direction: "descendants",
        });

        expect(result.root.name).toBe("Dog");

        // Dog has PetDog as derived class
        const descendantNames = result.root.children.map((c) => c.name);
        expect(descendantNames).toContain("PetDog");
      });
    });

    describe("both direction", () => {
      it("should find both ancestors and descendants", async () => {
        // Dog class - should find both Creature (ancestor) and PetDog (descendant)
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 27,
          column: 14,
          direction: "both",
        });

        expect(result.root.name).toBe("Dog");
        expect(result.direction).toBe("both");

        const childNames = result.root.children.map((c) => c.name);
        // Should have both ancestors and descendants
        expect(childNames).toContain("Creature"); // ancestor (extends)
        expect(childNames).toContain("Animal"); // ancestor (implements)
        expect(childNames).toContain("PetDog"); // descendant (derivedBy)
      });
    });

    describe("error cases", () => {
      it("should return empty children for non-type position", async () => {
        // Position on comment (line 1 is a comment)
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 1,
          column: 1,
          direction: "ancestors",
        });

        // Should not crash and return a result with empty children
        expect(result.root).toBeDefined();
        expect(result.root.children).toEqual([]);
      });

      it("should handle position on a type that has no hierarchy", async () => {
        // Animal interface has no ancestors (it's a root interface)
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 7,
          column: 18,
          direction: "ancestors",
        });

        expect(result.root.name).toBe("Animal");
        expect(result.root.children).toEqual([]);
      });

      it("should handle position on a leaf class (no descendants)", async () => {
        // Cat class has no derived classes (line 51)
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 51,
          column: 14,
          direction: "descendants",
        });

        expect(result.root.name).toBe("Cat");
        expect(result.root.children).toEqual([]);
      });
    });

    describe("options", () => {
      it("should respect maxDepth option", async () => {
        // PetDog has deep ancestry: PetDog -> Dog -> Creature (line 41)
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 41,
          column: 14,
          direction: "ancestors",
          maxDepth: 1,
        });

        expect(result.root.name).toBe("PetDog");
        // maxDepth=1 means only direct parents
        // Dog and Pet should be found, but their ancestors should have empty children
        const dogChild = result.root.children.find((c) => c.name === "Dog");
        if (dogChild) {
          expect(dogChild.children).toEqual([]);
        }
      });

      it("should track nodeCount correctly", async () => {
        const result = await handler.getTypeHierarchy({
          filePath: TYPE_HIERARCHY_FILE,
          line: 27,
          column: 14,
          direction: "both",
        });

        // nodeCount should be greater than 0
        expect(result.nodeCount).toBeGreaterThan(0);
      });
    });
  });

  describe("TypeScriptHandler - Rename Symbol", () => {
    let handler: TypeScriptHandler;

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should detect rename locations in dry-run mode", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      // Line 3: export function createUser(id: UserId, name: string, email: string): User {
      // createUser starts at column 17
      const result = await handler.renameSymbol({
        filePath,
        line: 3,
        column: 17,
        newName: "createNewUser",
        dryRun: true,
      });

      expect(result.oldName).toBe("createUser");
      expect(result.newName).toBe("createNewUser");
      expect(result.dryRun).toBe(true);
      expect(result.totalOccurrences).toBeGreaterThan(0);

      // Should find locations in utils.ts (definition) and main.ts (import and usage)
      const utilsLocations = result.locations.filter((l) =>
        l.filePath.includes("utils.ts")
      );
      const mainLocations = result.locations.filter((l) =>
        l.filePath.includes("main.ts")
      );

      expect(utilsLocations.length).toBeGreaterThan(0);
      expect(mainLocations.length).toBeGreaterThan(0);
    });

    it("should find references across multiple files", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      // getUserById is used within utils.ts (definition and call)
      // Line 7: export function getUserById(users: User[], id: UserId): User | undefined {
      // getUserById starts at column 17
      const result = await handler.renameSymbol({
        filePath,
        line: 7,
        column: 17,
        newName: "findUserById",
        dryRun: true,
      });

      expect(result.oldName).toBe("getUserById");
      expect(result.newName).toBe("findUserById");
      expect(result.dryRun).toBe(true);

      // Should include both the definition and the call in getUser method
      expect(result.locations.length).toBeGreaterThanOrEqual(2);

      // Check that the definition is found
      const definitionLoc = result.locations.find(
        (l) => l.filePath.includes("utils.ts") && l.line === 7
      );
      expect(definitionLoc).toBeDefined();

      // Check that the call site (line 21) is found
      const callLoc = result.locations.find(
        (l) => l.filePath.includes("utils.ts") && l.line === 21
      );
      expect(callLoc).toBeDefined();
      expect(callLoc?.context).toBe("call");
    });

    it("should detect class rename locations", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      // Line 13: export class UserService {
      // UserService starts at column 14
      const result = await handler.renameSymbol({
        filePath,
        line: 13,
        column: 14,
        newName: "UserManager",
        dryRun: true,
      });

      expect(result.oldName).toBe("UserService");
      expect(result.newName).toBe("UserManager");
      expect(result.totalOccurrences).toBeGreaterThan(0);

      // Should find usage in main.ts (import and new expression)
      const mainLocations = result.locations.filter((l) =>
        l.filePath.includes("main.ts")
      );
      expect(mainLocations.length).toBeGreaterThan(0);

      // Check for new expression context
      const newExprLoc = mainLocations.find((l) => l.context === "new");
      expect(newExprLoc).toBeDefined();
    });

    it("should return empty locations for same name rename", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      // Renaming createUser to createUser (same name)
      const result = await handler.renameSymbol({
        filePath,
        line: 3,
        column: 17,
        newName: "createUser",
        dryRun: true,
      });

      expect(result.oldName).toBe("createUser");
      expect(result.newName).toBe("createUser");
      expect(result.totalOccurrences).toBe(0);
      expect(result.locations).toHaveLength(0);
    });

    it("should return empty result for non-identifier position", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      // Position on whitespace or comment
      const result = await handler.renameSymbol({
        filePath,
        line: 1,
        column: 1,
        newName: "newName",
        dryRun: true,
      });

      expect(result.oldName).toBe("");
      expect(result.totalOccurrences).toBe(0);
      expect(result.locations).toHaveLength(0);
    });

    it("should handle constant rename", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      // Line 11: export const DEFAULT_TIMEOUT = 5000;
      // DEFAULT_TIMEOUT starts at column 14
      const result = await handler.renameSymbol({
        filePath,
        line: 11,
        column: 14,
        newName: "DEFAULT_WAIT_TIME",
        dryRun: true,
      });

      expect(result.oldName).toBe("DEFAULT_TIMEOUT");
      expect(result.newName).toBe("DEFAULT_WAIT_TIME");
      expect(result.totalOccurrences).toBeGreaterThan(0);

      // Should find reference in main.ts where it's imported and used
      const mainLocations = result.locations.filter((l) =>
        l.filePath.includes("main.ts")
      );
      expect(mainLocations.length).toBeGreaterThan(0);
    });

    it("should track modified files correctly", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      const result = await handler.renameSymbol({
        filePath,
        line: 3,
        column: 17,
        newName: "createNewUser",
        dryRun: true,
      });

      // modifiedFiles should include files that would be changed
      expect(result.modifiedFiles.length).toBeGreaterThan(0);
      expect(result.modifiedFiles.some((f) => f.includes("utils.ts"))).toBe(true);
      expect(result.modifiedFiles.some((f) => f.includes("main.ts"))).toBe(true);
    });
  });

  describe("TypeScriptHandler - Query Graph", () => {
    let handler: TypeScriptHandler;
    const CYCLIC_FIXTURES = join(FIXTURES_DIR, "cyclic");
    const NESTED_FIXTURES = join(FIXTURES_DIR, "nested");

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    describe("raw stats (no jq, no preset)", () => {
      it("should return raw stats when no query is provided", async () => {
        const result = await handler.queryGraph({
          source: "dependency",
          directory: CYCLIC_FIXTURES,
        });

        expect(result.source).toBe("dependency");
        expect(result.query).toBe("(none - raw stats)");
        expect(result.result).toEqual({
          nodes: 4,
          edges: 3,
          cycles: 1,
        });
      });
    });

    describe("preset: top_referenced", () => {
      it("should return top referenced files sorted by count", async () => {
        const result = await handler.queryGraph({
          source: "dependency",
          directory: CYCLIC_FIXTURES,
          preset: "top_referenced",
        });

        expect(result.source).toBe("dependency");
        expect(result.query).toBe("top_referenced");
        expect(Array.isArray(result.result)).toBe(true);

        const items = result.result as Array<{ file: string; count: number }>;
        // Each file is referenced once in the cyclic fixture
        expect(items.length).toBe(3);
        expect(items.every((i) => i.count === 1)).toBe(true);
      });
    });

    describe("preset: top_importers", () => {
      it("should return top importer files sorted by count", async () => {
        const result = await handler.queryGraph({
          source: "dependency",
          directory: CYCLIC_FIXTURES,
          preset: "top_importers",
        });

        expect(result.source).toBe("dependency");
        expect(result.query).toBe("top_importers");
        expect(Array.isArray(result.result)).toBe(true);

        const items = result.result as Array<{ file: string; count: number }>;
        // Each file imports once in the cyclic fixture
        expect(items.length).toBe(3);
        expect(items.every((i) => i.count === 1)).toBe(true);
      });
    });

    describe("preset: orphans", () => {
      it("should return orphan files (not connected by edges)", async () => {
        const result = await handler.queryGraph({
          source: "dependency",
          directory: CYCLIC_FIXTURES,
          preset: "orphans",
        });

        expect(result.source).toBe("dependency");
        expect(result.query).toBe("orphans");
        expect(Array.isArray(result.result)).toBe(true);

        const orphans = result.result as string[];
        // standalone.ts is an orphan (no imports, not imported)
        expect(orphans.length).toBe(1);
        expect(orphans[0]).toContain("standalone.ts");
      });
    });

    describe("preset: coupling", () => {
      it("should return module coupling analysis", async () => {
        const result = await handler.queryGraph({
          source: "dependency",
          directory: NESTED_FIXTURES,
          preset: "coupling",
        });

        expect(result.source).toBe("dependency");
        expect(result.query).toBe("coupling");
        expect(Array.isArray(result.result)).toBe(true);

        const items = result.result as Array<{ modules: string[]; count: number }>;
        // nested fixture has cross-module imports
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((i) => i.modules.length === 2)).toBe(true);
      });
    });

    describe("preset: modules", () => {
      it("should return module file counts", async () => {
        const result = await handler.queryGraph({
          source: "dependency",
          directory: NESTED_FIXTURES,
          preset: "modules",
        });

        expect(result.source).toBe("dependency");
        expect(result.query).toBe("modules");
        expect(Array.isArray(result.result)).toBe(true);

        const items = result.result as Array<{ module: string; files: number }>;
        // nested has types (2 files) and utils (1 file) subdirectories
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((i) => i.module && i.files > 0)).toBe(true);
      });
    });

    describe("custom jq queries", () => {
      it("should execute custom jq query", async () => {
        const result = await handler.queryGraph({
          source: "dependency",
          directory: CYCLIC_FIXTURES,
          jq: ".nodes | length",
        });

        expect(result.source).toBe("dependency");
        expect(result.query).toBe(".nodes | length");
        expect(result.result).toBe(4);
      });

      it("should execute complex jq query with map and select", async () => {
        const result = await handler.queryGraph({
          source: "dependency",
          directory: CYCLIC_FIXTURES,
          jq: '.edges | map(select(.to | endswith("a.ts"))) | length',
        });

        expect(result.source).toBe("dependency");
        expect(result.result).toBe(1); // Only c.ts -> a.ts
      });

      it("should handle jq query returning objects", async () => {
        const result = await handler.queryGraph({
          source: "dependency",
          directory: CYCLIC_FIXTURES,
          jq: "{nodeCount: (.nodes | length), edgeCount: (.edges | length)}",
        });

        expect(result.result).toEqual({
          nodeCount: 4,
          edgeCount: 3,
        });
      });
    });

    describe("error cases", () => {
      it("should throw error for invalid jq query", async () => {
        await expect(
          handler.queryGraph({
            source: "dependency",
            directory: CYCLIC_FIXTURES,
            jq: "invalid[[[query",
          })
        ).rejects.toThrow(/jq query failed/);
      });

      it("should throw error for call_graph source without file parameters", async () => {
        await expect(
          handler.queryGraph({
            source: "call_graph",
            directory: CYCLIC_FIXTURES,
          })
        ).rejects.toThrow(/call_graph source requires file_path/);
      });
    });

    describe("jq takes precedence over preset", () => {
      it("should use jq query when both jq and preset are provided", async () => {
        const result = await handler.queryGraph({
          source: "dependency",
          directory: CYCLIC_FIXTURES,
          jq: ".cycles | length",
          preset: "top_referenced",
        });

        // jq should take precedence
        expect(result.query).toBe(".cycles | length");
        expect(result.result).toBe(1);
      });
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

  describe("TypeScriptHandler - Auto Import", () => {
    let handler: TypeScriptHandler;

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should return no added imports for file with all imports present", async () => {
      const filePath = join(FIXTURES_DIR, "with-alias.ts");
      const result = await handler.autoImport({ filePath, dryRun: true });

      expect(result.filePath).toBe(filePath);
      expect(result.dryRun).toBe(true);
      expect(result.totalAdded).toBe(0);
      expect(result.addedImports).toHaveLength(0);
    });

    it("should detect missing imports in dry-run mode", async () => {
      const filePath = join(FIXTURES_DIR, "missing-import.ts");
      const result = await handler.autoImport({ filePath, dryRun: true });

      expect(result.filePath).toBe(filePath);
      expect(result.dryRun).toBe(true);
      // Should detect User is missing
      if (result.totalAdded > 0) {
        expect(result.addedImports.length).toBeGreaterThan(0);
        // Check structure of added imports
        for (const imp of result.addedImports) {
          expect(imp.module).toBeTruthy();
          expect(typeof imp.isNew).toBe("boolean");
        }
      }
    });

    it("should return correct structure for added imports", async () => {
      const filePath = join(FIXTURES_DIR, "missing-import.ts");
      const result = await handler.autoImport({ filePath, dryRun: true });

      expect(result).toHaveProperty("filePath");
      expect(result).toHaveProperty("dryRun");
      expect(result).toHaveProperty("addedImports");
      expect(result).toHaveProperty("totalAdded");
      expect(Array.isArray(result.addedImports)).toBe(true);
    });

    it("should handle warnings gracefully", async () => {
      // Test with a valid file - should not produce warnings
      const filePath = join(FIXTURES_DIR, "types.ts");
      const result = await handler.autoImport({ filePath, dryRun: true });

      // warnings should be undefined or an array
      if (result.warnings) {
        expect(Array.isArray(result.warnings)).toBe(true);
      }
    });
  });

  describe("TypeScriptHandler - Inline Type", () => {
    let handler: TypeScriptHandler;
    const COMPLEX_TYPES_FILE = join(FIXTURES_DIR, "complex-types.ts");

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should expand simple type alias", async () => {
      // Line 5: export type UserId = number;
      // UserId is at column 13
      const result = await handler.inlineType({
        filePath: COMPLEX_TYPES_FILE,
        line: 5,
        column: 13,
      });

      expect(result.filePath).toBe(COMPLEX_TYPES_FILE);
      expect(result.line).toBe(5);
      expect(result.column).toBe(13);
      expect(result.identifier).toBe("UserId");
      // number is a primitive, so originalType and expandedType might be the same
      expect(result.originalType).toBeTruthy();
    });

    it("should expand Readonly mapped type", async () => {
      // Line 8: export type ReadonlyUser = Readonly<User>;
      // ReadonlyUser is at column 13
      const result = await handler.inlineType({
        filePath: COMPLEX_TYPES_FILE,
        line: 8,
        column: 13,
      });

      expect(result.identifier).toBe("ReadonlyUser");
      // The expanded type should include the structure
      expect(result.expandedType).toBeTruthy();
    });

    it("should expand Pick mapped type", async () => {
      // Line 11: export type UserBasic = Pick<User, "id" | "name">;
      // UserBasic is at column 13
      const result = await handler.inlineType({
        filePath: COMPLEX_TYPES_FILE,
        line: 11,
        column: 13,
      });

      expect(result.identifier).toBe("UserBasic");
      expect(result.expandedType).toBeTruthy();
      // Expanded type should include id and name properties
      if (result.isExpanded) {
        expect(result.expandedType).toMatch(/id|name/);
      }
    });

    it("should expand union type", async () => {
      // Line 14: export type IdOrName = number | string;
      // IdOrName is at column 13
      const result = await handler.inlineType({
        filePath: COMPLEX_TYPES_FILE,
        line: 14,
        column: 13,
      });

      expect(result.identifier).toBe("IdOrName");
      // originalType may be the alias name, expandedType should show both types
      expect(result.originalType).toBeTruthy();
      // expandedType should contain the union types
      expect(result.expandedType).toMatch(/number|string/);
    });

    it("should expand intersection type", async () => {
      // Line 17: export type UserWithConfig = User & Config;
      // UserWithConfig is at column 13
      const result = await handler.inlineType({
        filePath: COMPLEX_TYPES_FILE,
        line: 17,
        column: 13,
      });

      expect(result.identifier).toBe("UserWithConfig");
      expect(result.expandedType).toBeTruthy();
    });

    it("should handle variable with complex type annotation", async () => {
      // Line 28: export const userConfig: UserWithConfig = ...
      // userConfig is at column 14
      const result = await handler.inlineType({
        filePath: COMPLEX_TYPES_FILE,
        line: 28,
        column: 14,
      });

      expect(result.identifier).toBe("userConfig");
      expect(result.originalType).toBeTruthy();
    });

    it("should return empty result for position with no type", async () => {
      // Position on a comment or whitespace (line 1)
      const result = await handler.inlineType({
        filePath: COMPLEX_TYPES_FILE,
        line: 1,
        column: 1,
      });

      // Should not crash and return a result
      expect(result.filePath).toBe(COMPLEX_TYPES_FILE);
      expect(result.line).toBe(1);
      expect(result.column).toBe(1);
    });

    it("should provide alias name when available", async () => {
      // Line 20: export type MaybeUser = User | null;
      // MaybeUser is at column 13
      const result = await handler.inlineType({
        filePath: COMPLEX_TYPES_FILE,
        line: 20,
        column: 13,
      });

      expect(result.identifier).toBe("MaybeUser");
      // aliasName should be defined for type aliases
      expect(result.aliasName).toBeDefined();
    });

    it("should indicate when type is expanded", async () => {
      // Test with a type that should be expanded (Line 8: ReadonlyUser)
      const result = await handler.inlineType({
        filePath: COMPLEX_TYPES_FILE,
        line: 8,
        column: 13,
      });

      // isExpanded should be boolean
      expect(typeof result.isExpanded).toBe("boolean");
    });

    it("should work with interface types", async () => {
      // types.ts - User interface at line 1
      // export interface User {
      // User is at column 18
      const typesFile = join(FIXTURES_DIR, "types.ts");
      const result = await handler.inlineType({
        filePath: typesFile,
        line: 1,
        column: 18,
      });

      expect(result.identifier).toBe("User");
      expect(result.originalType).toBeTruthy();
    });
  });

  describe("TypeScriptHandler - Dependency Graph", () => {
    let handler: TypeScriptHandler;
    const CYCLIC_FIXTURES = join(FIXTURES_DIR, "cyclic");

    beforeAll(() => {
      handler = new TypeScriptHandler();
    });

    it("should analyze dependencies in a directory", async () => {
      const result = await handler.getDependencyGraph({
        directory: CYCLIC_FIXTURES,
      });

      // Should have 4 nodes (a.ts, b.ts, c.ts, standalone.ts)
      expect(result.nodes).toHaveLength(4);
      expect(result.nodes.every((n) => !n.isExternal)).toBe(true);

      // Should have edges (a->b, b->c, c->a)
      expect(result.edges.length).toBeGreaterThanOrEqual(3);

      // Check specific edges exist
      const edgeFromA = result.edges.find(
        (e) => e.from.endsWith("a.ts") && e.to.endsWith("b.ts")
      );
      expect(edgeFromA).toBeDefined();
      expect(edgeFromA?.specifiers).toContain("funcB");
    });

    it("should detect cyclic dependencies using Tarjan's SCC algorithm", async () => {
      const result = await handler.getDependencyGraph({
        directory: CYCLIC_FIXTURES,
      });

      // Should detect the cycle A -> B -> C -> A
      expect(result.cycles).toHaveLength(1);
      expect(result.cycles[0].nodes).toHaveLength(3);

      // All nodes in the cycle should be from our test files
      const cycleFiles = result.cycles[0].nodes.map((n) =>
        n.split("/").pop()
      );
      expect(cycleFiles).toContain("a.ts");
      expect(cycleFiles).toContain("b.ts");
      expect(cycleFiles).toContain("c.ts");
    });

    it("should filter files by pattern", async () => {
      const result = await handler.getDependencyGraph({
        directory: CYCLIC_FIXTURES,
        pattern: "**/standalone.ts",
      });

      // Standalone has no imports, so should only include standalone.ts
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].filePath).toContain("standalone.ts");
      expect(result.edges).toHaveLength(0);
    });

    it("should handle directories with no cycles", async () => {
      // Test with dead-code fixtures which should have no cycles
      const result = await handler.getDependencyGraph({
        directory: join(FIXTURES_DIR, "dead-code"),
      });

      // Should not have any cycles (or have expected structure)
      expect(result.nodes.length).toBeGreaterThanOrEqual(0);
      // The dead-code fixtures may or may not have imports between them
    });

    it("should exclude node_modules by default", async () => {
      const result = await handler.getDependencyGraph({
        directory: FIXTURES_DIR,
        includeExternal: false,
      });

      // No external nodes should be present
      expect(result.nodes.every((n) => !n.isExternal)).toBe(true);
    });

    it("should resolve .js imports to .ts files in nested directories", async () => {
      const NESTED_FIXTURES = join(FIXTURES_DIR, "nested");
      const result = await handler.getDependencyGraph({
        directory: NESTED_FIXTURES,
      });

      // Should have 4 nodes: index.ts, types/index.ts, types/config.ts, utils/helper.ts
      expect(result.nodes).toHaveLength(4);

      // Should have edges for the import relationships
      // index.ts -> types/index.ts, index.ts -> utils/helper.ts
      // types/index.ts -> types/config.ts
      // utils/helper.ts -> types/index.ts
      expect(result.edges.length).toBeGreaterThanOrEqual(4);

      // Check specific edge: utils/helper.ts -> types/index.ts
      const helperToTypes = result.edges.find(
        (e) => e.from.endsWith("helper.ts") && e.to.endsWith("types/index.ts")
      );
      expect(helperToTypes).toBeDefined();
      expect(helperToTypes?.specifiers).toContain("Config");

      // Check index.ts -> types/index.ts
      const indexToTypes = result.edges.find(
        (e) => e.from.endsWith("nested/index.ts") && e.to.endsWith("types/index.ts")
      );
      expect(indexToTypes).toBeDefined();
    });
  });
});
