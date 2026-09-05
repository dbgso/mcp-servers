import { describe, expect, it } from "vitest";

import { prepareGraph } from "../elements.js";
import { GraphVizError } from "../errors.js";
import {
  AREA_BASED_LAYOUTS,
  buildLayoutSpec,
  computePositions,
  estimateBoundingBox,
  groupParallelEdges,
  layoutGraph,
  MIN_LAYOUT_EXTENT,
  needsBoundingBox,
  pairKey,
  routeEdges,
} from "../layout.js";
import type { GraphInput, LaidOutNode, LayoutName } from "../types.js";

const ALL_LAYOUTS: LayoutName[] = [
  "dagre",
  "cose",
  "concentric",
  "grid",
  "circle",
  "breadthfirst",
  "preset",
];

describe("needsBoundingBox", () => {
  it.each(ALL_LAYOUTS.map((name) => ({ name })))("$name", ({ name }) => {
    expect(needsBoundingBox({ name })).toBe(AREA_BASED_LAYOUTS.includes(name));
  });
});

describe("buildLayoutSpec", () => {
  it("defaults to dagre", () => {
    expect(buildLayoutSpec({}).name).toBe("dagre");
  });

  it("rejects an unknown layout", () => {
    expect(() => buildLayoutSpec({ layout: { name: "spiral" as LayoutName } })).toThrow(GraphVizError);
  });

  /**
   * cytoscape rescales results into `boundingBox`, so handing one to dagre or
   * cose would replace the spacing those layouts just computed.
   */
  it.each(ALL_LAYOUTS.filter((name) => !AREA_BASED_LAYOUTS.includes(name)).map((name) => ({ name })))(
    "omits boundingBox for $name",
    ({ name }) => {
      expect(buildLayoutSpec({ layout: { name } }).boundingBox).toBeUndefined();
    },
  );

  it.each(AREA_BASED_LAYOUTS.map((name) => ({ name })))("supplies boundingBox for $name", ({ name }) => {
    expect(buildLayoutSpec({ layout: { name } }).boundingBox).toBeDefined();
  });

  it("passes the direction through to dagre", () => {
    expect(buildLayoutSpec({ layout: { name: "dagre", direction: "LR" } }).rankDir).toBe("LR");
  });

  it("scales dagre separation with spacing", () => {
    const tight = buildLayoutSpec({ layout: { name: "dagre", spacing: 1 } });
    const loose = buildLayoutSpec({ layout: { name: "dagre", spacing: 2 } });
    expect(Number(loose.nodeSep)).toBe(Number(tight.nodeSep) * 2);
  });

  it("randomizes cose only when no seed was given", () => {
    expect(buildLayoutSpec({ layout: { name: "cose" } }).randomize).toBe(true);
    expect(buildLayoutSpec({ layout: { name: "cose", seed: 1 } }).randomize).toBe(false);
  });

  it("sets breadthfirst to directed", () => {
    expect(buildLayoutSpec({ layout: { name: "breadthfirst" } }).directed).toBe(true);
  });

  it("sets concentric node spacing", () => {
    expect(buildLayoutSpec({ layout: { name: "concentric", spacing: 2 } }).minNodeSpacing).toBe(60);
  });

  it("never animates or fits, so results are deterministic", () => {
    const spec = buildLayoutSpec({ layout: { name: "grid" } });
    expect(spec).toMatchObject({ animate: false, fit: false, padding: 0 });
  });
});

describe("estimateBoundingBox", () => {
  const nodes = [
    { width: 100, height: 40 },
    { width: 100, height: 40 },
  ];

  it("uses the explicit size when both dimensions are given", () => {
    expect(estimateBoundingBox({ nodes, spacing: 1, width: 300, height: 200 })).toEqual({
      x1: 0,
      y1: 0,
      w: 300,
      h: 200,
    });
  });

  it("grows with the number of nodes", () => {
    const small = estimateBoundingBox({ nodes, spacing: 1 });
    const large = estimateBoundingBox({ nodes: [...nodes, ...nodes, ...nodes], spacing: 1 });
    expect(large.w).toBeGreaterThan(small.w);
  });

  it("grows with the spacing factor", () => {
    const tight = estimateBoundingBox({ nodes, spacing: 1 });
    const loose = estimateBoundingBox({ nodes, spacing: 2 });
    expect(loose.w).toBeGreaterThan(tight.w);
  });

  it("stays above the minimum extent for an empty graph", () => {
    expect(estimateBoundingBox({ nodes: [], spacing: 1 })).toEqual({
      x1: 0,
      y1: 0,
      w: MIN_LAYOUT_EXTENT,
      h: MIN_LAYOUT_EXTENT,
    });
  });

  it("is wider than it is tall", () => {
    const box = estimateBoundingBox({ nodes, spacing: 1 });
    expect(box.w).toBeGreaterThan(box.h);
  });
});

describe("pairKey", () => {
  it("is the same in both directions", () => {
    expect(pairKey({ source: "a", target: "b" })).toBe(pairKey({ source: "b", target: "a" }));
  });
});

describe("groupParallelEdges", () => {
  it("bundles edges between the same pair regardless of direction", () => {
    const prepared = prepareGraph({
      graph: {
        nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
        edges: [
          { source: "a", target: "b" },
          { source: "b", target: "a" },
          { source: "a", target: "c" },
        ],
      },
    });
    const bundles = groupParallelEdges({ edges: prepared.edges });
    expect(bundles.get(pairKey({ source: "a", target: "b" }))).toHaveLength(2);
    expect(bundles.get(pairKey({ source: "a", target: "c" }))).toHaveLength(1);
  });
});

describe("routeEdges", () => {
  const nodes: LaidOutNode[] = [
    {
      id: "a",
      label: "a",
      lines: ["a"],
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      shape: "roundRect",
      swatch: { fill: "#fff", stroke: "#000", text: "#000" },
    },
    {
      id: "b",
      label: "b",
      lines: ["b"],
      x: 300,
      y: 0,
      width: 100,
      height: 40,
      shape: "roundRect",
      swatch: { fill: "#fff", stroke: "#000", text: "#000" },
    },
  ];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  it("clips endpoints to the node boundaries rather than centers", () => {
    const prepared = prepareGraph({
      graph: { nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b" }] },
    });
    const [edge] = routeEdges({ edges: prepared.edges, nodesById });
    expect(edge.sourcePoint).toEqual({ x: 50, y: 0 });
    expect(edge.targetPoint).toEqual({ x: 250, y: 0 });
    expect(edge.controlPoints).toEqual([]);
  });

  it("curves parallel edges apart", () => {
    const prepared = prepareGraph({
      graph: {
        nodes: [{ id: "a" }, { id: "b" }],
        edges: [
          { source: "a", target: "b" },
          { source: "b", target: "a" },
        ],
      },
    });
    const routed = routeEdges({ edges: prepared.edges, nodesById });
    expect(routed[0].controlPoints).toHaveLength(1);
    expect(routed[1].controlPoints).toHaveLength(1);
    expect(routed[0].controlPoints[0].y).toBeCloseTo(-routed[1].controlPoints[0].y, 5);
  });

  it("draws a self loop as an arc with two control points", () => {
    const prepared = prepareGraph({
      graph: { nodes: [{ id: "a" }], edges: [{ source: "a", target: "a" }] },
    });
    const [edge] = routeEdges({ edges: prepared.edges, nodesById });
    expect(edge.controlPoints).toHaveLength(2);
    expect(edge.sourcePoint.y).toBe(-20);
  });
});

describe("computePositions", () => {
  it("returns a position for every node", async () => {
    const prepared = prepareGraph({
      graph: { nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b" }] },
    });
    const positions = await computePositions({ prepared, layout: { name: "grid" } });
    expect([...positions.keys()].sort()).toEqual(["a", "b"]);
  });

  it("handles an empty graph without throwing", async () => {
    const prepared = prepareGraph({ graph: { nodes: [], edges: [] } });
    await expect(computePositions({ prepared, layout: { name: "grid" } })).resolves.toEqual(new Map());
  });

  it("honours preset positions", async () => {
    const prepared = prepareGraph({
      graph: { nodes: [{ id: "a", position: { x: 42, y: 24 } }], edges: [] },
    });
    const positions = await computePositions({ prepared, layout: { name: "preset" } });
    expect(positions.get("a")).toEqual({ x: 42, y: 24 });
  });
});

describe("layoutGraph", () => {
  const graph: GraphInput = {
    nodes: [
      { id: "a", group: "g" },
      { id: "b", group: "g" },
      { id: "c" },
    ],
    edges: [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ],
  };

  it.each(ALL_LAYOUTS.filter((name) => name !== "preset").map((name) => ({ name })))(
    "produces finite coordinates with $name",
    async ({ name }) => {
      const laidOut = await layoutGraph({ graph, layout: { name } });
      for (const node of laidOut.nodes) {
        expect(Number.isFinite(node.x)).toBe(true);
        expect(Number.isFinite(node.y)).toBe(true);
        // Regression guard: breadthfirst produced ~1e49 before boundingBox
        // was supplied for area-based layouts.
        expect(Math.abs(node.x)).toBeLessThan(100000);
        expect(Math.abs(node.y)).toBeLessThan(100000);
      }
    },
  );

  it("keeps dagre nodes from overlapping", async () => {
    const many: GraphInput = {
      nodes: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}` })),
      edges: [],
    };
    const laidOut = await layoutGraph({ graph: many, layout: { name: "dagre", direction: "LR" } });
    const sorted = [...laidOut.nodes].sort((left, right) => left.y - right.y);
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i].y - sorted[i - 1].y;
      const halfHeights = sorted[i].height / 2 + sorted[i - 1].height / 2;
      expect(gap).toBeGreaterThan(halfHeights);
    }
  });

  it("reports the groups for the legend", async () => {
    const laidOut = await layoutGraph({ graph, layout: { name: "grid" } });
    expect(laidOut.groups.map((group) => group.name)).toEqual(["g"]);
  });

  it("bounds cover every node", async () => {
    const laidOut = await layoutGraph({ graph, layout: { name: "grid" } });
    for (const node of laidOut.nodes) {
      expect(node.x - node.width / 2).toBeGreaterThanOrEqual(laidOut.bounds.x);
      expect(node.x + node.width / 2).toBeLessThanOrEqual(laidOut.bounds.x + laidOut.bounds.width);
    }
  });

  it("rejects the preset layout when a node has no position", async () => {
    await expect(layoutGraph({ graph, layout: { name: "preset" } })).rejects.toThrow(
      /"preset" layout requires a position on every node/,
    );
  });

  it("is deterministic with the preset layout", async () => {
    const preset: GraphInput = {
      nodes: [
        { id: "a", position: { x: 0, y: 0 } },
        { id: "b", position: { x: 200, y: 100 } },
      ],
      edges: [{ source: "a", target: "b" }],
    };
    const first = await layoutGraph({ graph: preset, layout: { name: "preset" } });
    const second = await layoutGraph({ graph: preset, layout: { name: "preset" } });
    expect(first.nodes.map((node) => [node.x, node.y])).toEqual(
      second.nodes.map((node) => [node.x, node.y]),
    );
  });
});
