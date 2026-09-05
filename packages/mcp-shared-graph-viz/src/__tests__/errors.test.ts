import { describe, expect, it } from "vitest";

import {
  assertKnownLayout,
  assertValidGraph,
  findDanglingEndpoints,
  findDuplicateNodeIds,
  findMissingParents,
  GraphVizError,
  LAYOUT_NAMES,
  resolveEdgeId,
} from "../errors.js";
import type { GraphInput } from "../types.js";

describe("resolveEdgeId", () => {
  type Case = { name: string; edge: { id?: string; source: string; target: string }; index: number; expected: string };
  const cases: Case[] = [
    { name: "uses the explicit id", edge: { id: "e1", source: "a", target: "b" }, index: 0, expected: "e1" },
    { name: "derives from endpoints", edge: { source: "a", target: "b" }, index: 3, expected: "a->b#3" },
  ];

  it.each(cases)("$name", ({ edge, index, expected }) => {
    expect(resolveEdgeId({ edge, index })).toBe(expected);
  });
});

describe("findDuplicateNodeIds", () => {
  type Case = { name: string; graph: GraphInput; expected: string[] };
  const cases: Case[] = [
    { name: "no duplicates", graph: { nodes: [{ id: "a" }, { id: "b" }], edges: [] }, expected: [] },
    { name: "one duplicate", graph: { nodes: [{ id: "a" }, { id: "a" }], edges: [] }, expected: ["a"] },
    {
      name: "reports each duplicate once",
      graph: { nodes: [{ id: "a" }, { id: "a" }, { id: "a" }, { id: "b" }], edges: [] },
      expected: ["a"],
    },
  ];

  it.each(cases)("$name", ({ graph, expected }) => {
    expect(findDuplicateNodeIds({ graph })).toEqual(expected);
  });
});

describe("findDanglingEndpoints", () => {
  it("reports both ends when neither exists", () => {
    const graph: GraphInput = { nodes: [], edges: [{ id: "e", source: "x", target: "y" }] };
    expect(findDanglingEndpoints({ graph })).toEqual([
      { edgeId: "e", end: "source", missingId: "x" },
      { edgeId: "e", end: "target", missingId: "y" },
    ]);
  });

  it("reports nothing for a well-formed graph", () => {
    const graph: GraphInput = { nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b" }] };
    expect(findDanglingEndpoints({ graph })).toEqual([]);
  });

  it("identifies the edge by its positional id when no id was given", () => {
    const graph: GraphInput = {
      nodes: [{ id: "a" }],
      edges: [
        { source: "a", target: "a" },
        { source: "a", target: "missing" },
      ],
    };
    expect(findDanglingEndpoints({ graph })).toEqual([
      { edgeId: "a->missing#1", end: "target", missingId: "missing" },
    ]);
  });
});

describe("findMissingParents", () => {
  type Case = { name: string; graph: GraphInput; expected: string[] };
  const cases: Case[] = [
    { name: "no parents", graph: { nodes: [{ id: "a" }], edges: [] }, expected: [] },
    {
      name: "parent exists",
      graph: { nodes: [{ id: "box" }, { id: "a", parent: "box" }], edges: [] },
      expected: [],
    },
    {
      name: "parent missing",
      graph: { nodes: [{ id: "a", parent: "box" }], edges: [] },
      expected: ["box"],
    },
  ];

  it.each(cases)("$name", ({ graph, expected }) => {
    expect(findMissingParents({ graph })).toEqual(expected);
  });
});

describe("assertValidGraph", () => {
  it("accepts a well-formed graph", () => {
    const graph: GraphInput = { nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "a", target: "b" }] };
    expect(() => assertValidGraph({ graph })).not.toThrow();
  });

  type Case = { name: string; graph: GraphInput; message: RegExp };
  const cases: Case[] = [
    {
      name: "rejects duplicate ids",
      graph: { nodes: [{ id: "a" }, { id: "a" }], edges: [] },
      message: /Duplicate node ids: a/,
    },
    {
      name: "rejects dangling edges",
      graph: { nodes: [{ id: "a" }], edges: [{ id: "e", source: "a", target: "ghost" }] },
      message: /Edges reference unknown nodes: e \(target: "ghost"\)/,
    },
    {
      name: "rejects unknown parents",
      graph: { nodes: [{ id: "a", parent: "ghost" }], edges: [] },
      message: /Nodes reference unknown parents: ghost/,
    },
  ];

  it.each(cases)("$name", ({ graph, message }) => {
    expect(() => assertValidGraph({ graph })).toThrow(GraphVizError);
    expect(() => assertValidGraph({ graph })).toThrow(message);
  });
});

describe("assertKnownLayout", () => {
  it.each(LAYOUT_NAMES.map((name) => ({ name })))("accepts $name", ({ name }) => {
    expect(() => assertKnownLayout({ name })).not.toThrow();
  });

  it("lists the available layouts when the name is unknown", () => {
    expect(() => assertKnownLayout({ name: "spiral" })).toThrow(
      /Unknown layout "spiral"\. Available layouts: dagre, cose/,
    );
  });
});
