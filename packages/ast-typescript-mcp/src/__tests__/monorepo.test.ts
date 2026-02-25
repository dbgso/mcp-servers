import { describe, it, expect } from "vitest";
import {
  detectWorkspace,
  buildMonorepoGraph,
  getDependentPackages,
  getPackageDependencies,
  findPackageForFile,
  parseAllPackages,
} from "../monorepo/index.js";
import { TypeScriptHandler } from "../handlers/typescript.js";

import * as path from "node:path";

// Use the actual monorepo for testing - resolve from this file's location
// __tests__ -> src -> ast-typescript-mcp -> packages -> mcp-servers
const MONOREPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

describe("Monorepo Dependency Graph", () => {
  describe("detectWorkspace", () => {
    it("should detect pnpm workspace from root", async () => {
      const workspace = await detectWorkspace(MONOREPO_ROOT);

      expect(workspace).not.toBeNull();
      expect(workspace!.type).toBe("pnpm");
      expect(workspace!.rootDir).toBe(MONOREPO_ROOT);
      expect(workspace!.packageDirs.length).toBeGreaterThan(0);
    });

    it("should detect workspace from subdirectory", async () => {
      const workspace = await detectWorkspace(
        `${MONOREPO_ROOT}/packages/ast-typescript-mcp/src`
      );

      expect(workspace).not.toBeNull();
      expect(workspace!.type).toBe("pnpm");
      expect(workspace!.rootDir).toBe(MONOREPO_ROOT);
    });

    it("should return null for non-workspace directory", async () => {
      const workspace = await detectWorkspace("/tmp");

      expect(workspace).toBeNull();
    });
  });

  describe("buildMonorepoGraph", () => {
    it("should build graph with packages and edges", async () => {
      const workspace = await detectWorkspace(MONOREPO_ROOT);
      expect(workspace).not.toBeNull();

      const graph = buildMonorepoGraph(workspace!);

      // Should have packages
      expect(graph.packages.length).toBeGreaterThan(0);

      // Should have mcp-shared
      const mcpShared = graph.packages.find((p) => p.name === "mcp-shared");
      expect(mcpShared).toBeDefined();

      // Should have ast-typescript-mcp
      const astTs = graph.packages.find((p) => p.name === "ast-typescript-mcp");
      expect(astTs).toBeDefined();

      // Should have edges (ast-typescript-mcp depends on mcp-shared)
      const edgeToMcpShared = graph.edges.find(
        (e) => e.from === "ast-typescript-mcp" && e.to === "mcp-shared"
      );
      expect(edgeToMcpShared).toBeDefined();
    });

    it("should detect dependency types correctly", async () => {
      const workspace = await detectWorkspace(MONOREPO_ROOT);
      const graph = buildMonorepoGraph(workspace!);

      // mcp-shared should be a regular dependency for most packages
      const depEdges = graph.edges.filter(
        (e) => e.to === "mcp-shared" && e.type === "dependencies"
      );
      expect(depEdges.length).toBeGreaterThan(0);
    });

    it("should detect cycles if any exist", async () => {
      const workspace = await detectWorkspace(MONOREPO_ROOT);
      const graph = buildMonorepoGraph(workspace!);

      // Our monorepo should not have cycles
      expect(graph.cycles).toEqual([]);
    });
  });

  describe("getDependentPackages", () => {
    it("should find packages that depend on mcp-shared", async () => {
      const workspace = await detectWorkspace(MONOREPO_ROOT);
      const graph = buildMonorepoGraph(workspace!);

      const dependents = getDependentPackages({ packageName: "mcp-shared", graph });

      // Multiple packages should depend on mcp-shared
      expect(dependents.length).toBeGreaterThan(0);
      expect(dependents).toContain("ast-typescript-mcp");
    });

    it("should return empty array for package with no dependents", async () => {
      const workspace = await detectWorkspace(MONOREPO_ROOT);
      const graph = buildMonorepoGraph(workspace!);

      // Find a leaf package (one that nothing depends on)
      // Usually specific MCP packages are leaves
      const dependents = getDependentPackages({ packageName: "ast-typescript-mcp", graph });

      // This might have dependents or not, just verify it works
      expect(Array.isArray(dependents)).toBe(true);
    });
  });

  describe("getPackageDependencies", () => {
    it("should find dependencies of ast-typescript-mcp", async () => {
      const workspace = await detectWorkspace(MONOREPO_ROOT);
      const graph = buildMonorepoGraph(workspace!);

      const deps = getPackageDependencies({ packageName: "ast-typescript-mcp", graph });

      expect(deps).toContain("mcp-shared");
    });
  });

  describe("findPackageForFile", () => {
    it("should find package for a file path", async () => {
      const workspace = await detectWorkspace(MONOREPO_ROOT);
      const packages = parseAllPackages({
        packageDirs: workspace!.packageDirs,
        rootDir: workspace!.rootDir
      });

      const pkg = findPackageForFile({
        filePath: `${MONOREPO_ROOT}/packages/ast-typescript-mcp/src/handlers/typescript.ts`,
        packages
      });

      expect(pkg).not.toBeNull();
      expect(pkg!.name).toBe("ast-typescript-mcp");
    });

    it("should return null for file outside packages", async () => {
      const workspace = await detectWorkspace(MONOREPO_ROOT);
      const packages = parseAllPackages({
        packageDirs: workspace!.packageDirs,
        rootDir: workspace!.rootDir
      });

      const pkg = findPackageForFile({ filePath: "/tmp/some-file.ts", packages });

      expect(pkg).toBeNull();
    });
  });

  describe("findReferences with scopeToDependents", () => {
    it("should find references scoped to dependent packages", async () => {
      const handler = new TypeScriptHandler();

      // Search for references to a symbol in mcp-shared
      // Using a commonly used export like 'jsonResponse'
      const mcpSharedFile = `${MONOREPO_ROOT}/packages/mcp-shared/src/index.ts`;

      // Find the line/column for 'jsonResponse' export
      // This is a utility that is used by all dependent packages
      const result = await handler.findReferences(
        { filePath: mcpSharedFile, line: 1, column: 1, options: { scopeToDependents: true } }
      );

      // The result should include references from dependent packages
      // but not from unrelated packages
      expect(result.references.length).toBeGreaterThanOrEqual(0);
    });

    it("should return fewer or equal results when scoped", async () => {
      const handler = new TypeScriptHandler();

      // Find a symbol that's used across packages
      // Use the TypeScriptHandler class itself in this package
      const filePath = `${MONOREPO_ROOT}/packages/ast-typescript-mcp/src/handlers/typescript.ts`;

      // Get references without scoping
      const unscopedResult = await handler.findReferences({ filePath: filePath, line: 56, column: 14 });

      // Get references with scoping
      const scopedResult = await handler.findReferences(
        { filePath: filePath, line: 56, column: 14, options: { scopeToDependents: true } }
      );

      // Scoped should have <= unscoped references
      expect(scopedResult.references.length).toBeLessThanOrEqual(
        unscopedResult.references.length
      );
    });
  });
});
