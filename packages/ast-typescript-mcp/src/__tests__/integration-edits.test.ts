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

});
