import { describe, expect, it } from "vitest";

import { GraphVizError, renderGraphSvg } from "../index.js";
import type { GraphInput } from "../types.js";

/**
 * The public entry point, exercised the way a calling MCP server would use it:
 * hand over nodes and edges, get a diagram back.
 */
describe("renderGraphSvg", () => {
  const graph: GraphInput = {
    nodes: [
      { id: "every-task", label: "every-task", group: "root" },
      { id: "plan-tool-required", label: "workflow / plan-tool-required", group: "workflow" },
      { id: "task-planning-tools", label: "workflow / task-planning-tools", group: "workflow" },
    ],
    edges: [
      { source: "every-task", target: "plan-tool-required", kind: "related" },
      { source: "every-task", target: "task-planning-tools", kind: "related" },
      { source: "plan-tool-required", target: "task-planning-tools", kind: "related" },
    ],
  };

  it("renders with nothing but a graph", async () => {
    const svg = await renderGraphSvg({ graph });
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("draws every node and edge", async () => {
    const svg = await renderGraphSvg({ graph });
    for (const node of graph.nodes) {
      expect(svg).toContain(`data-node-id="${node.id}"`);
    }
    expect(svg.match(/data-edge-id=/g)).toHaveLength(3);
  });

  it("passes the title and legend through", async () => {
    const svg = await renderGraphSvg({ graph, title: "Topic relations" });
    expect(svg).toContain("Topic relations");
    expect(svg).toContain(">workflow</text>");
  });

  it("produces no NaN coordinates for any layout", async () => {
    for (const name of ["dagre", "grid", "circle", "concentric", "breadthfirst", "cose"] as const) {
      const svg = await renderGraphSvg({ graph, layout: { name } });
      expect(svg).not.toContain("NaN");
    }
  });

  it("renders an empty graph without throwing", async () => {
    const svg = await renderGraphSvg({ graph: { nodes: [], edges: [] } });
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("surfaces a caller mapping mistake as an error", async () => {
    await expect(
      renderGraphSvg({ graph: { nodes: [{ id: "a" }], edges: [{ source: "a", target: "ghost" }] } }),
    ).rejects.toThrow(GraphVizError);
  });

  it("honours explicit node sizes and shapes", async () => {
    const svg = await renderGraphSvg({
      graph: { nodes: [{ id: "a", width: 200, height: 100, shape: "ellipse" }], edges: [] },
      layout: { name: "grid" },
    });
    expect(svg).toContain('rx="100"');
    expect(svg).toContain('ry="50"');
  });
});
