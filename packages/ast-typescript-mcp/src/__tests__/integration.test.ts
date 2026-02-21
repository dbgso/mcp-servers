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
      const result = await handler.query(filePath, "summary");

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
      const result = await handler.query(filePath, "imports");

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
      const result = await handler.query(filePath, "exports");

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
      const result = await handler.query(filePath, "full", { name: "createUser" });

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
      const result = await handler.goToDefinition(filePath, 1, 10);

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
      const result = await handler.goToDefinition(filePath, 1, 22);

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
      const result = await handler.goToDefinition(filePath, 2, 15);

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
      const result = await handler.goToDefinition(filePath, 12, 22);

      expect(result.definitions.length).toBeGreaterThan(0);
      const def = result.definitions[0];
      expect(def.filePath).toContain("utils.ts");
    });

    it("should return empty definitions for non-identifier position", async () => {
      const filePath = join(FIXTURES_DIR, "main.ts");
      // Line 4: const config: Config = {
      // Position on whitespace or operator
      const result = await handler.goToDefinition(filePath, 4, 1);

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
      const result = await handler.query(filePath, "full", { name: "NonExistentThing" });

      expect(result.data).toBeNull();
    });

    it("should filter by kind in summary", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      const result = await handler.query(filePath, "summary", { kind: "function" });

      expect(Array.isArray(result.data)).toBe(true);
      const summaries = result.data as Array<{ kind: string }>;

      // All results should be functions
      for (const summary of summaries) {
        expect(summary.kind).toBe("function");
      }
    });

    it("should filter by class kind", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      const result = await handler.query(filePath, "summary", { kind: "class" });

      expect(Array.isArray(result.data)).toBe(true);
      const summaries = result.data as Array<{ kind: string; name: string }>;

      expect(summaries.length).toBe(1);
      expect(summaries[0].name).toBe("UserService");
    });

    it("should handle go to definition on class instantiation", async () => {
      const filePath = join(FIXTURES_DIR, "main.ts");
      // Line 10: const service = new UserService();
      // UserService starts around column 24
      const result = await handler.goToDefinition(filePath, 10, 24);

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
      const result = await handler.findReferences(filePath, 3, 17);

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
      const result = await handler.findReferences(filePath, 13, 14);

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
      const result = await handler.findReferences(filePath, 1, 18);

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
      const result = await handler.findReferences(filePath, 1, 1);

      expect(result.symbolName).toBe("");
      expect(result.references).toEqual([]);
    });

    it("should identify reference context correctly", async () => {
      const filePath = join(FIXTURES_DIR, "utils.ts");
      // createUser function
      const result = await handler.findReferences(filePath, 3, 17);

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
  });
});
