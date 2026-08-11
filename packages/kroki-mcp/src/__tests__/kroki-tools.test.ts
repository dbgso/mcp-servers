import { describe, test, expect } from "vitest";
import { getAllTools, getTool, getRecommendations, useCaseRecommendations } from "../diagrams/registry.js";
import { getGuidelines } from "../diagrams/guidelines/index.js";
import { describeOperation } from "../operations/describe-ops.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function getText(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}

// ─── Diagram Registry tests ───────────────────────────────────────────────

describe("Diagram Registry", () => {
  describe("getAllTools", () => {
    test("should return all diagram tools", () => {
      const tools = getAllTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    test("should include main tools", () => {
      const tools = getAllTools();
      const ids = tools.map(t => t.id);
      expect(ids).toContain("mermaid");
      expect(ids).toContain("plantuml");
      expect(ids).toContain("d2");
      expect(ids).toContain("graphviz");
    });

    test("all tools have required fields", () => {
      const tools = getAllTools();
      for (const tool of tools) {
        expect(tool.id).toBeTruthy();
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.website).toBeTruthy();
        expect(tool.strengths.length).toBeGreaterThan(0);
        expect(tool.bestFor.length).toBeGreaterThan(0);
        expect(tool.subDiagrams.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getTool", () => {
    test.each(["mermaid", "plantuml", "d2", "graphviz", "structurizr"])("should return tool: %s", (id) => {
      const tool = getTool(id);
      expect(tool).toBeDefined();
      expect(tool!.id).toBe(id);
    });

    test("should return undefined for unknown tool", () => {
      expect(getTool("nonexistent")).toBeUndefined();
    });
  });

  describe("getRecommendations", () => {
    test("should return all recommendations without filter", () => {
      const recs = getRecommendations();
      expect(recs.length).toBe(useCaseRecommendations.length);
    });

    test("should filter by category", () => {
      const recs = getRecommendations("sequence");
      expect(recs.length).toBeGreaterThan(0);
      recs.forEach(r => expect(r.category).toBe("sequence"));
    });

    test("should return empty for unknown category", () => {
      const recs = getRecommendations("nonexistent");
      expect(recs).toEqual([]);
    });
  });

  describe("subDiagrams", () => {
    test("mermaid should have flowchart and sequence", () => {
      const tool = getTool("mermaid")!;
      const ids = tool.subDiagrams.map(s => s.id);
      expect(ids).toContain("flowchart");
      expect(ids).toContain("sequence");
      expect(ids).toContain("classDiagram");
      expect(ids).toContain("erDiagram");
    });

    test("plantuml should have sequence and class", () => {
      const tool = getTool("plantuml")!;
      const ids = tool.subDiagrams.map(s => s.id);
      expect(ids).toContain("sequence");
      expect(ids).toContain("class");
      expect(ids).toContain("component");
    });

    test("d2 should have containers and sequence", () => {
      const tool = getTool("d2")!;
      const ids = tool.subDiagrams.map(s => s.id);
      expect(ids).toContain("basic");
      expect(ids).toContain("containers");
      expect(ids).toContain("sequence");
    });

    test("all subDiagrams have required fields", () => {
      const tools = getAllTools();
      for (const tool of tools) {
        for (const sub of tool.subDiagrams) {
          expect(sub.id).toBeTruthy();
          expect(sub.name).toBeTruthy();
          expect(sub.category).toBeTruthy();
          expect(sub.description).toBeTruthy();
          expect(sub.example).toBeTruthy();
        }
      }
    });
  });
});

// ─── Guidelines tests ─────────────────────────────────────────────────────

describe("Guidelines", () => {
  describe("getGuidelines", () => {
    test.each(["mermaid", "plantuml", "d2"])("should return guidelines for %s", (toolId) => {
      const guidelines = getGuidelines(toolId);
      expect(guidelines).toBeDefined();
      expect(guidelines!.overview).toBeTruthy();
      expect(guidelines!.references.length).toBeGreaterThan(0);
    });

    test("should return undefined for tool without guidelines", () => {
      expect(getGuidelines("graphviz")).toBeUndefined();
      expect(getGuidelines("nonexistent")).toBeUndefined();
    });
  });

  describe("mermaid guidelines", () => {
    test("should have flowchart subDiagram guide", () => {
      const guidelines = getGuidelines("mermaid")!;
      expect(guidelines.subDiagrams.flowchart).toBeDefined();
      expect(guidelines.subDiagrams.flowchart.syntax).toContain("flowchart");
      expect(guidelines.subDiagrams.flowchart.bestPractices.length).toBeGreaterThan(0);
    });

    test("should have sequence subDiagram guide", () => {
      const guidelines = getGuidelines("mermaid")!;
      expect(guidelines.subDiagrams.sequence).toBeDefined();
      expect(guidelines.subDiagrams.sequence.syntax).toContain("sequenceDiagram");
    });

    test("should have erDiagram subDiagram guide", () => {
      const guidelines = getGuidelines("mermaid")!;
      expect(guidelines.subDiagrams.erDiagram).toBeDefined();
    });
  });

  describe("plantuml guidelines", () => {
    test("should have sequence subDiagram guide", () => {
      const guidelines = getGuidelines("plantuml")!;
      expect(guidelines.subDiagrams.sequence).toBeDefined();
      expect(guidelines.subDiagrams.sequence.syntax).toContain("@startuml");
    });

    test("should have class subDiagram guide", () => {
      const guidelines = getGuidelines("plantuml")!;
      expect(guidelines.subDiagrams.class).toBeDefined();
    });
  });

  describe("d2 guidelines", () => {
    test("should have containers subDiagram guide", () => {
      const guidelines = getGuidelines("d2")!;
      expect(guidelines.subDiagrams.containers).toBeDefined();
      expect(guidelines.subDiagrams.containers.syntax).toContain("Container");
    });

    test("should have styling subDiagram guide", () => {
      const guidelines = getGuidelines("d2")!;
      expect(guidelines.subDiagrams.styling).toBeDefined();
    });
  });
});

// ─── Describe Operation tests ─────────────────────────────────────────────

describe("describeOperation", () => {
  describe("overview (no arguments)", () => {
    test("should return overview with all tools", async () => {
      const result = await describeOperation.execute({});
      const text = getText(result);

      expect(text).toContain("# Kroki Diagram Tools");
      expect(text).toContain("Mermaid");
      expect(text).toContain("PlantUML");
      expect(text).toContain("D2");
      expect(text).toContain("Use Case Recommendations");
    });

    test("should include quick start guide", async () => {
      const result = await describeOperation.execute({});
      const text = getText(result);

      expect(text).toContain("Quick Start");
      expect(text).toContain("kroki_describe");
      expect(text).toContain("kroki_render");
    });
  });

  describe("tool guide", () => {
    test("should return mermaid guide", async () => {
      const result = await describeOperation.execute({ tool: "mermaid" });
      const text = getText(result);

      expect(text).toContain("# Mermaid Guidelines");
      expect(text).toContain("mermaid.js.org");
      expect(text).toContain("Available Sub-Diagrams");
    });

    test("should return plantuml guide", async () => {
      const result = await describeOperation.execute({ tool: "plantuml" });
      const text = getText(result);

      expect(text).toContain("# PlantUML Guidelines");
      expect(text).toContain("plantuml.com");
    });

    test("should return d2 guide", async () => {
      const result = await describeOperation.execute({ tool: "d2" });
      const text = getText(result);

      expect(text).toContain("# D2 Guidelines");
      expect(text).toContain("d2lang.com");
    });

    test("should return error for unknown tool", async () => {
      const result = await describeOperation.execute({ tool: "nonexistent" });
      const text = getText(result);

      expect(text).toContain("Unknown tool");
      expect(text).toContain("kroki_describe()");
    });
  });

  describe("subDiagram guide", () => {
    test("should return mermaid flowchart guide", async () => {
      const result = await describeOperation.execute({ tool: "mermaid", subDiagram: "flowchart" });
      const text = getText(result);

      expect(text).toContain("Mermaid - flowchart");
      expect(text).toContain("Flowchart Syntax");
      expect(text).toContain("Node Shapes");
      expect(text).toContain("Arrow Types");
      expect(text).toContain("Best Practices");
      expect(text).toContain("References");
    });

    test("should return mermaid sequence guide", async () => {
      const result = await describeOperation.execute({ tool: "mermaid", subDiagram: "sequence" });
      const text = getText(result);

      expect(text).toContain("Sequence Diagram Syntax");
      expect(text).toContain("Arrow Types");
      expect(text).toContain("Participants");
    });

    test("should return plantuml sequence guide", async () => {
      const result = await describeOperation.execute({ tool: "plantuml", subDiagram: "sequence" });
      const text = getText(result);

      expect(text).toContain("PlantUML - sequence");
      expect(text).toContain("@startuml");
    });

    test("should return d2 containers guide", async () => {
      const result = await describeOperation.execute({ tool: "d2", subDiagram: "containers" });
      const text = getText(result);

      expect(text).toContain("D2 - containers");
      expect(text).toContain("Container");
    });

    test("should fallback for unknown subDiagram with guidelines", async () => {
      const result = await describeOperation.execute({ tool: "mermaid", subDiagram: "pie" });
      const text = getText(result);

      // pie doesn't have detailed guidelines, should fallback to basic info
      expect(text).toContain("Mermaid");
    });

    test("should return error for completely unknown subDiagram", async () => {
      const result = await describeOperation.execute({ tool: "mermaid", subDiagram: "nonexistent" });
      const text = getText(result);

      expect(text).toContain("Unknown sub-diagram");
      expect(text).toContain("Available:");
    });
  });

  describe("tools without detailed guidelines", () => {
    test("should return basic info for graphviz", async () => {
      const result = await describeOperation.execute({ tool: "graphviz" });
      const text = getText(result);

      expect(text).toContain("GraphViz");
      expect(text).toContain("Strengths");
      expect(text).toContain("Weaknesses");
      expect(text).toContain("Sub-Diagram Types");
    });

    test("should return basic info for structurizr", async () => {
      const result = await describeOperation.execute({ tool: "structurizr" });
      const text = getText(result);

      expect(text).toContain("Structurizr");
      expect(text).toContain("C4");
    });
  });
});

// ─── Operation metadata tests ─────────────────────────────────────────────

describe("Operation metadata", () => {
  test("describeOperation has correct metadata", () => {
    expect(describeOperation.id).toBe("list");
    expect(describeOperation.summary).toBeTruthy();
    expect(describeOperation.detail).toBeTruthy();
    expect(describeOperation.argsSchema).toBeDefined();
    expect(typeof describeOperation.execute).toBe("function");
  });
});
