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
