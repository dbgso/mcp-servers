import { describe, expect, it } from "vitest";

import {
  CYTOSCAPE_SHAPES,
  DEFAULT_NODE_SHAPE,
  prepareGraph,
  preparedToElements,
  presetPositions,
  toCytoscapeElements,
} from "../elements.js";
import { GraphVizError } from "../errors.js";
import { DEFAULT_PALETTE } from "../theme.js";
import type { GraphInput, NodeShape } from "../types.js";

const simple: GraphInput = {
  nodes: [
    { id: "a", label: "Alpha", group: "one" },
    { id: "b", group: "two" },
  ],
  edges: [{ source: "a", target: "b", label: "to" }],
};

describe("prepareGraph", () => {
  it("falls back to the id when no label is given", () => {
    expect(prepareGraph({ graph: simple }).nodes.map((node) => node.label)).toEqual(["Alpha", "b"]);
  });

  it("applies the default shape", () => {
    expect(prepareGraph({ graph: simple }).nodes[0].shape).toBe(DEFAULT_NODE_SHAPE);
  });

  it("keeps an explicit shape", () => {
    const prepared = prepareGraph({ graph: { nodes: [{ id: "a", shape: "diamond" }], edges: [] } });
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
    expect(prepareGraph({ graph: simple }).edges[0]).toMatchObject({
      id: "a->b#0",
      directed: true,
      label: "to",
    });
  });

  it("keeps an explicit undirected flag", () => {
    const prepared = prepareGraph({
      graph: {
        nodes: [{ id: "a" }, { id: "b" }],
        edges: [{ source: "a", target: "b", directed: false }],
      },
    });
    expect(prepared.edges[0].directed).toBe(false);
  });

  it("passes caller data through untouched", () => {
    const data = { anything: { nested: true } };
    const prepared = prepareGraph({ graph: { nodes: [{ id: "a", data }], edges: [] } });
    expect(prepared.nodes[0].data).toBe(data);
  });

  it("rejects an invalid graph", () => {
    expect(() => prepareGraph({ graph: { nodes: [], edges: [{ source: "x", target: "y" }] } })).toThrow(
      GraphVizError,
    );
  });
});

describe("prepareGraph with a caller-supplied group order", () => {
  const graph: GraphInput = {
    nodes: [{ id: "a", group: "spec" }, { id: "b", group: "adr" }],
    edges: [],
  };
  const groupOrder = ["requirement", "spec", "design", "adr"];

  it("colours a node by its slot in the caller's order, not this view's", () => {
    const prepared = prepareGraph({ graph, groupOrder });
    expect(prepared.nodes[0].swatch).toBe(DEFAULT_PALETTE.swatches[1]);
    expect(prepared.nodes[1].swatch).toBe(DEFAULT_PALETTE.swatches[3]);
  });

  /** The colour is reserved; the legend still describes what is on screen. */
  it("leaves absent groups out of the legend", () => {
    expect(prepareGraph({ graph, groupOrder }).groups.map((g) => g.name)).toEqual(["spec", "adr"]);
  });

  it("gives the same node the same colour in a smaller view", () => {
    const closeUp: GraphInput = { nodes: [{ id: "b", group: "adr" }], edges: [] };
    expect(prepareGraph({ graph: closeUp, groupOrder }).nodes[0].swatch).toBe(
      prepareGraph({ graph, groupOrder }).nodes[1].swatch,
    );
  });
});

describe("CYTOSCAPE_SHAPES", () => {
  type Case = { shape: NodeShape; expected: string };
  const cases: Case[] = [
    { shape: "roundRect", expected: "round-rectangle" },
    { shape: "rect", expected: "rectangle" },
    { shape: "ellipse", expected: "ellipse" },
    { shape: "diamond", expected: "diamond" },
  ];

  it.each(cases)("maps $shape to $expected", ({ shape, expected }) => {
    expect(CYTOSCAPE_SHAPES[shape]).toBe(expected);
  });
});

describe("preparedToElements", () => {
  it("emits one element per node and edge", () => {
    const elements = preparedToElements({ prepared: prepareGraph({ graph: simple }) });
    expect(elements.filter((element) => element.group === "nodes")).toHaveLength(2);
    expect(elements.filter((element) => element.group === "edges")).toHaveLength(1);
  });

  /** The browser measures the label, so no size is emitted unless asked for. */
  it("omits size unless the caller fixed it", () => {
    const elements = preparedToElements({ prepared: prepareGraph({ graph: simple }) });
    expect(elements[0].data).not.toHaveProperty("width");
    expect(elements[0].data).not.toHaveProperty("height");
  });

  it("carries a fixed size when given", () => {
    const prepared = prepareGraph({ graph: { nodes: [{ id: "a", width: 200, height: 60 }], edges: [] } });
    expect(preparedToElements({ prepared })[0].data).toMatchObject({ width: 200, height: 60 });
  });

  it("omits the parent key for ordinary nodes", () => {
    const elements = preparedToElements({ prepared: prepareGraph({ graph: simple }) });
    expect(elements[0].data).not.toHaveProperty("parent");
  });

  it("carries the parent key for compound nodes", () => {
    const graph: GraphInput = { nodes: [{ id: "box" }, { id: "a", parent: "box" }], edges: [] };
    expect(preparedToElements({ prepared: prepareGraph({ graph }) })[1].data.parent).toBe("box");
  });

  it("carries href and tooltip only when set", () => {
    const graph: GraphInput = {
      nodes: [{ id: "a", href: "https://example.com", tooltip: "hint" }, { id: "b" }],
      edges: [],
    };
    const elements = preparedToElements({ prepared: prepareGraph({ graph }) });
    expect(elements[0].data).toMatchObject({ href: "https://example.com", tooltip: "hint" });
    expect(elements[1].data).not.toHaveProperty("href");
    expect(elements[1].data).not.toHaveProperty("tooltip");
  });

  it("marks direction on the edge so the arrow style can select it", () => {
    const graph: GraphInput = {
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [
        { source: "a", target: "b" },
        { source: "b", target: "a", directed: false, kind: "related" },
      ],
    };
    const edges = preparedToElements({ prepared: prepareGraph({ graph }) }).filter(
      (element) => element.group === "edges",
    );
    expect(edges[0].data.directed).toBe(true);
    expect(edges[1].data).toMatchObject({ directed: false, kind: "related" });
  });
});

describe("presetPositions", () => {
  it("collects only the nodes that carry a position", () => {
    const graph: GraphInput = {
      nodes: [{ id: "a", position: { x: 1, y: 2 } }, { id: "b" }],
      edges: [],
    };
    const positions = presetPositions({ prepared: prepareGraph({ graph }) });
    expect([...positions]).toEqual([["a", { x: 1, y: 2 }]]);
  });
});

describe("toCytoscapeElements", () => {
  it("is the escape hatch from graph input to cytoscape elements", () => {
    expect(toCytoscapeElements({ graph: simple }).map((element) => element.data.id)).toEqual([
      "a",
      "b",
      "a->b#0",
    ]);
  });
});
