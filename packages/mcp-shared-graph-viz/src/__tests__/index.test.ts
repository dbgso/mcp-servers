import { describe, expect, it } from "vitest";

import { GraphVizError, renderGraphHtml, toCytoscapeElements } from "../index.js";
import type { GraphInput } from "../types.js";

/**
 * The public entry point, exercised the way a calling MCP server would use it:
 * hand over nodes and edges, get a page a human can look at.
 */
describe("renderGraphHtml", () => {
  const graph: GraphInput = {
    nodes: [
      { id: "every-task", label: "every-task", group: "root", href: "https://example.com/t" },
      { id: "plan-tool-required", label: "workflow / plan-tool-required", group: "workflow" },
      { id: "task-planning-tools", label: "workflow / task-planning-tools", group: "workflow" },
    ],
    edges: [
      { source: "every-task", target: "plan-tool-required", kind: "related" },
      { source: "every-task", target: "task-planning-tools", kind: "related" },
      { source: "plan-tool-required", target: "task-planning-tools", kind: "related" },
    ],
  };

  it("renders with nothing but a graph", () => {
    expect(renderGraphHtml({ graph }).startsWith("<!doctype html>")).toBe(true);
  });

  it("carries every node and edge into the page", () => {
    const html = renderGraphHtml({ graph });
    for (const node of graph.nodes) {
      expect(html).toContain(JSON.stringify(node.id));
    }
    expect(html.match(/"group":"edges"/g)).toHaveLength(3);
  });

  it("keeps an href so the node can be clicked through", () => {
    expect(renderGraphHtml({ graph })).toContain("https://example.com/t");
  });

  it("labels the legend with the groups", () => {
    const html = renderGraphHtml({ graph, title: "Topic relations" });
    expect(html).toContain("Topic relations");
    expect(html).toContain(">workflow</span>");
    expect(html).toContain(">root</span>");
  });

  it("surfaces a caller mapping mistake as an error", () => {
    expect(() =>
      renderGraphHtml({ graph: { nodes: [{ id: "a" }], edges: [{ source: "a", target: "ghost" }] } }),
    ).toThrow(GraphVizError);
  });
});

describe("toCytoscapeElements", () => {
  it("hands back plain cytoscape elements for callers that drive cytoscape themselves", () => {
    const elements = toCytoscapeElements({
      graph: { nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b" }] },
    });
    expect(elements).toHaveLength(3);
    expect(elements[2]).toMatchObject({ group: "edges", data: { source: "a", target: "b" } });
  });
});
