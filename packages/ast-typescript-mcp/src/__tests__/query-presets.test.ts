import { describe, it, expect } from "vitest";
import {
  getQueryPresetRegistry,
  TopReferencedHandler,
  TopImportersHandler,
  OrphansHandler,
  CouplingHandler,
  ModulesHandler,
} from "../handlers/query-presets/index.js";
import type { QueryPresetContext } from "../handlers/query-presets/types.js";
import type { DependencyGraphResult } from "../types/index.js";

describe("Query Preset Handlers", () => {
  // Mock data for testing
  const mockData: DependencyGraphResult = {
    nodes: [
      { filePath: "/src/a.ts", isExternal: false },
      { filePath: "/src/b.ts", isExternal: false },
      { filePath: "/src/c.ts", isExternal: false },
      { filePath: "/src/orphan.ts", isExternal: false },
    ],
    edges: [
      { from: "/src/a.ts", to: "/src/b.ts", specifiers: ["funcB"] },
      { from: "/src/b.ts", to: "/src/c.ts", specifiers: ["funcC"] },
      { from: "/src/c.ts", to: "/src/a.ts", specifiers: ["funcA"] },
    ],
    cycles: [{ nodes: ["/src/a.ts", "/src/b.ts", "/src/c.ts"] }],
  };

  const context: QueryPresetContext = { data: mockData };

  describe("Registry", () => {
    it("should return singleton instance", () => {
      const registry1 = getQueryPresetRegistry();
      const registry2 = getQueryPresetRegistry();
      expect(registry1).toBe(registry2);
    });

    it("should have all presets registered", () => {
      const registry = getQueryPresetRegistry();
      expect(registry.hasPreset("top_referenced")).toBe(true);
      expect(registry.hasPreset("top_importers")).toBe(true);
      expect(registry.hasPreset("orphans")).toBe(true);
      expect(registry.hasPreset("coupling")).toBe(true);
      expect(registry.hasPreset("modules")).toBe(true);
    });

    it("should return all preset names", () => {
      const registry = getQueryPresetRegistry();
      const names = registry.getPresetNames();
      expect(names).toContain("top_referenced");
      expect(names).toContain("top_importers");
      expect(names).toContain("orphans");
      expect(names).toContain("coupling");
      expect(names).toContain("modules");
    });
  });

  describe("TopReferencedHandler", () => {
    it("should have correct preset name", () => {
      const handler = new TopReferencedHandler();
      expect(handler.preset).toBe("top_referenced");
    });

    it("should return valid jq query", () => {
      const handler = new TopReferencedHandler();
      const query = handler.getQuery();
      expect(query).toContain(".edges");
      expect(query).toContain("group_by(.to)");
    });

    it("should execute and return result", () => {
      const handler = new TopReferencedHandler();
      const result = handler.execute(context);
      expect(result.preset).toBe("top_referenced");
      expect(result.jqQuery).toBeDefined();
      expect(Array.isArray(result.result)).toBe(true);
    });
  });

  describe("TopImportersHandler", () => {
    it("should have correct preset name", () => {
      const handler = new TopImportersHandler();
      expect(handler.preset).toBe("top_importers");
    });

    it("should return valid jq query", () => {
      const handler = new TopImportersHandler();
      const query = handler.getQuery();
      expect(query).toContain(".edges");
      expect(query).toContain("group_by(.from)");
    });

    it("should execute and return result", () => {
      const handler = new TopImportersHandler();
      const result = handler.execute(context);
      expect(result.preset).toBe("top_importers");
      expect(Array.isArray(result.result)).toBe(true);
    });
  });

  describe("OrphansHandler", () => {
    it("should have correct preset name", () => {
      const handler = new OrphansHandler();
      expect(handler.preset).toBe("orphans");
    });

    it("should return valid jq query", () => {
      const handler = new OrphansHandler();
      const query = handler.getQuery();
      expect(query).toContain(".nodes");
      expect(query).toContain(".edges");
    });

    it("should execute and find orphan file", () => {
      const handler = new OrphansHandler();
      const result = handler.execute(context);
      expect(result.preset).toBe("orphans");
      expect(Array.isArray(result.result)).toBe(true);
      expect(result.result as string[]).toContain("/src/orphan.ts");
    });
  });

  describe("CouplingHandler", () => {
    it("should have correct preset name", () => {
      const handler = new CouplingHandler();
      expect(handler.preset).toBe("coupling");
    });

    it("should return valid jq query", () => {
      const handler = new CouplingHandler();
      const query = handler.getQuery();
      expect(query).toContain(".edges");
      expect(query).toContain("split");
    });

    it("should execute and return result", () => {
      const handler = new CouplingHandler();
      const result = handler.execute(context);
      expect(result.preset).toBe("coupling");
      // Result should be array (possibly empty if all files in same directory)
      expect(Array.isArray(result.result)).toBe(true);
    });
  });

  describe("ModulesHandler", () => {
    it("should have correct preset name", () => {
      const handler = new ModulesHandler();
      expect(handler.preset).toBe("modules");
    });

    it("should return valid jq query", () => {
      const handler = new ModulesHandler();
      const query = handler.getQuery();
      expect(query).toContain(".nodes");
      expect(query).toContain("group_by");
    });

    it("should execute and return module counts", () => {
      const handler = new ModulesHandler();
      const result = handler.execute(context);
      expect(result.preset).toBe("modules");
      expect(Array.isArray(result.result)).toBe(true);
      const items = result.result as Array<{ module: string; files: number }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].module).toBe("src");
      expect(items[0].files).toBe(4);
    });
  });

  describe("Handler polymorphism", () => {
    it("should use handlers polymorphically via registry", () => {
      const registry = getQueryPresetRegistry();
      const presets = ["top_referenced", "top_importers", "orphans", "coupling", "modules"] as const;

      for (const preset of presets) {
        const handler = registry.getHandler(preset);
        expect(handler).toBeDefined();
        expect(handler!.preset).toBe(preset);

        const result = handler!.execute(context);
        expect(result.preset).toBe(preset);
        expect(result.jqQuery).toBeDefined();
      }
    });
  });
});
