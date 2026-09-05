import { describe, expect, it } from "vitest";

import { DEFAULT_NODE_SHAPE, prepareGraph, preparedToElements, toCytoscapeElements } from "../elements.js";
import { GraphVizError } from "../errors.js";
import { DEFAULT_PALETTE } from "../theme.js";
import type { GraphInput } from "../types.js";

const simple: GraphInput = {
  nodes: [
    { id: "a", label: "Alpha", group: "one" },
    { id: "b", group: "two" },
  ],
  edges: [{ source: "a", target: "b", label: "to" }],
};

describe("prepareGraph", () => {
  it("falls back to the id when no label is given", () => {
    const prepared = prepareGraph({ graph: simple });
    expect(prepared.nodes.map((node) => node.label)).toEqual(["Alpha", "b"]);
  });

  it("applies the default shape", () => {
    const prepared = prepareGraph({ graph: simple });
    expect(prepared.nodes[0].shape).toBe(DEFAULT_NODE_SHAPE);
  });

  it("keeps an explicit shape", () => {
    const prepared = prepareGraph({
      graph: { nodes: [{ id: "a", shape: "diamond" }], edges: [] },
    });
    expect(prepared.nodes[0].shape).toBe("diamond");
  });

  it("assigns swatches by group in first-appearance order", () => {
    const prepared = prepareGraph({ graph: simple });
    expect(prepared.nodes[0].swatch).toBe(DEFAULT_PALETTE.swatches[0]);
    expect(prepared.nodes[1].swatch).toBe(DEFAULT_PALETTE.swatches[1]);
    expect(prepared.groups).toEqual([
      { name: "one", swatch: DEFAULT_PALETTE.swatches[0] },
      { name: "two", swatch: DEFAULT_PALETTE.swatches[1] },
    ]);
  });

  it("defaults edges to directed and derives ids", () => {
    const prepared = prepareGraph({ graph: simple });
    expect(prepared.edges[0]).toMatchObject({ id: "a->b#0", directed: true, label: "to" });
  });

  it("keeps an explicit undirected flag", () => {
    const prepared = prepareGraph({
      graph: { nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b", directed: false }] },
    });
    expect(prepared.edges[0].directed).toBe(false);
  });

  it("passes caller data through untouched", () => {
    const data = { anything: { nested: true } };
    const prepared = prepareGraph({ graph: { nodes: [{ id: "a", data }], edges: [] } });
    expect(prepared.nodes[0].data).toBe(data);
  });

  it("uses a caller-supplied measure function", () => {
    const prepared = prepareGraph({
      graph: { nodes: [{ id: "a", label: "wide" }], edges: [] },
      measureLabel: () => 400,
    });
    expect(prepared.nodes[0].width).toBeGreaterThan(400);
  });

  it("rejects an invalid graph", () => {
    expect(() => prepareGraph({ graph: { nodes: [], edges: [{ source: "x", target: "y" }] } })).toThrow(
      GraphVizError,
    );
  });
});

describe("preparedToElements", () => {
  it("emits one element per node and edge", () => {
    const elements = preparedToElements({ prepared: prepareGraph({ graph: simple }) });
    expect(elements.filter((element) => element.group === "nodes")).toHaveLength(2);
    expect(elements.filter((element) => element.group === "edges")).toHaveLength(1);
  });

  it("omits the parent key for ordinary nodes", () => {
    const elements = preparedToElements({ prepared: prepareGraph({ graph: simple }) });
    expect(elements[0].data).not.toHaveProperty("parent");
  });

  it("carries the parent key for compound nodes", () => {
    const graph: GraphInput = { nodes: [{ id: "box" }, { id: "a", parent: "box" }], edges: [] };
    const elements = preparedToElements({ prepared: prepareGraph({ graph }) });
    expect(elements[1].data.parent).toBe("box");
  });

  it("includes a position only when one was supplied", () => {
    const graph: GraphInput = {
      nodes: [{ id: "a", position: { x: 5, y: 6 } }, { id: "b" }],
      edges: [],
    };
    const elements = preparedToElements({ prepared: prepareGraph({ graph }) });
    expect(elements[0].position).toEqual({ x: 5, y: 6 });
    expect(elements[1].position).toBeUndefined();
  });

  it("carries the measured size into the element data", () => {
    const elements = preparedToElements({ prepared: prepareGraph({ graph: simple }) });
    expect(elements[0].data.width).toBeGreaterThan(0);
    expect(elements[0].data.height).toBeGreaterThan(0);
  });
});

describe("toCytoscapeElements", () => {
  it("is the escape hatch from graph input to cytoscape elements", () => {
    const elements = toCytoscapeElements({ graph: simple });
    expect(elements.map((element) => element.data.id)).toEqual(["a", "b", "a->b#0"]);
  });
});
