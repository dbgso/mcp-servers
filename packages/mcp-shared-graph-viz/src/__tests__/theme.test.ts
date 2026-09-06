import { describe, expect, it } from "vitest";

import {
  buildSwatchMap,
  collectGroups,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_PALETTE,
  resolveTheme,
  swatchFor,
} from "../theme.js";
import type { GraphInput, Palette } from "../types.js";

describe("resolveTheme", () => {
  it("falls back to the defaults", () => {
    expect(resolveTheme({ theme: undefined })).toEqual({
      palette: DEFAULT_PALETTE,
      fontFamily: DEFAULT_FONT_FAMILY,
      fontSize: DEFAULT_FONT_SIZE,
    });
  });

  it("keeps caller overrides", () => {
    const palette: Palette = { ...DEFAULT_PALETTE, background: "#000000" };
    expect(resolveTheme({ theme: { palette, fontFamily: "serif", fontSize: 20 } })).toEqual({
      palette,
      fontFamily: "serif",
      fontSize: 20,
    });
  });
});

describe("collectGroups", () => {
  type Case = { name: string; graph: GraphInput; expected: string[] };
  const cases: Case[] = [
    { name: "no groups", graph: { nodes: [{ id: "a" }], edges: [] }, expected: [] },
    {
      name: "first-appearance order, not alphabetical",
      graph: { nodes: [{ id: "a", group: "z" }, { id: "b", group: "a" }], edges: [] },
      expected: ["z", "a"],
    },
    {
      name: "deduplicates",
      graph: {
        nodes: [{ id: "a", group: "x" }, { id: "b", group: "x" }, { id: "c", group: "y" }],
        edges: [],
      },
      expected: ["x", "y"],
    },
  ];

  it.each(cases)("$name", ({ graph, expected }) => {
    expect(collectGroups({ graph })).toEqual(expected);
  });
});

describe("collectGroups with a caller-supplied order", () => {
  /** The reported symptom: one document purple in one view, orange in another. */
  it("keeps a group's colour when a view contains fewer groups", () => {
    const groupOrder = ["adr", "design", "proposal", "requirement", "spec"];
    const whole: GraphInput = {
      nodes: groupOrder.map((group, i) => ({ id: `n${i}`, group })),
      edges: [],
    };
    const closeUp: GraphInput = {
      nodes: [{ id: "n3", group: "requirement" }, { id: "n4", group: "spec" }],
      edges: [],
    };

    const indexIn = (graph: GraphInput, group: string): number =>
      collectGroups({ graph, groupOrder }).indexOf(group);

    expect(indexIn(whole, "spec")).toBe(indexIn(closeUp, "spec"));
    expect(indexIn(whole, "requirement")).toBe(indexIn(closeUp, "requirement"));
  });

  it("moves a group's colour without one, which is why the option exists", () => {
    const whole: GraphInput = {
      nodes: [{ id: "a", group: "adr" }, { id: "b", group: "spec" }],
      edges: [],
    };
    const closeUp: GraphInput = { nodes: [{ id: "b", group: "spec" }], edges: [] };
    expect(collectGroups({ graph: whole }).indexOf("spec")).toBe(1);
    expect(collectGroups({ graph: closeUp }).indexOf("spec")).toBe(0);
  });

  it("keeps a listed group's slot even when this view has none of it", () => {
    const graph: GraphInput = { nodes: [{ id: "a", group: "spec" }], edges: [] };
    expect(collectGroups({ graph, groupOrder: ["adr", "design", "spec"] })).toEqual([
      "adr",
      "design",
      "spec",
    ]);
  });

  it("puts a group the caller forgot behind the ones it listed", () => {
    const graph: GraphInput = {
      nodes: [{ id: "a", group: "spec" }, { id: "b", group: "unlisted" }],
      edges: [],
    };
    expect(collectGroups({ graph, groupOrder: ["adr", "spec"] })).toEqual([
      "adr",
      "spec",
      "unlisted",
    ]);
  });

  /**
   * The tail is by name, so two views holding the same forgotten groups agree
   * even if their nodes arrive in a different order.
   */
  it("orders forgotten groups by name, not by where they turned up", () => {
    const oneWay: GraphInput = {
      nodes: [{ id: "a", group: "(unlinked)" }, { id: "b", group: "(missing)" }],
      edges: [],
    };
    const otherWay: GraphInput = {
      nodes: [{ id: "b", group: "(missing)" }, { id: "a", group: "(unlinked)" }],
      edges: [],
    };
    expect(collectGroups({ graph: oneWay, groupOrder: ["spec"] })).toEqual(
      collectGroups({ graph: otherWay, groupOrder: ["spec"] }),
    );
  });

  /** How far the fallback does not go: list a group that comes and goes. */
  it("still shifts a forgotten group when another one is absent", () => {
    const both: GraphInput = {
      nodes: [{ id: "a", group: "(missing)" }, { id: "b", group: "(unlinked)" }],
      edges: [],
    };
    const one: GraphInput = { nodes: [{ id: "b", group: "(unlinked)" }], edges: [] };
    expect(collectGroups({ graph: both, groupOrder: ["spec"] }).indexOf("(unlinked)")).toBe(2);
    expect(collectGroups({ graph: one, groupOrder: ["spec"] }).indexOf("(unlinked)")).toBe(1);
  });

  it("does not repeat a group the caller listed twice over", () => {
    const graph: GraphInput = { nodes: [{ id: "a", group: "spec" }], edges: [] };
    expect(collectGroups({ graph, groupOrder: ["spec", "adr"] })).toEqual(["spec", "adr"]);
  });
});

describe("buildSwatchMap", () => {
  it("assigns distinct swatches in order", () => {
    const map = buildSwatchMap({ groups: ["a", "b"], palette: DEFAULT_PALETTE });
    expect(map.get("a")).toBe(DEFAULT_PALETTE.swatches[0]);
    expect(map.get("b")).toBe(DEFAULT_PALETTE.swatches[1]);
  });

  it("cycles once the palette runs out", () => {
    const groups = Array.from({ length: DEFAULT_PALETTE.swatches.length + 1 }, (_, i) => `g${i}`);
    const map = buildSwatchMap({ groups, palette: DEFAULT_PALETTE });
    expect(map.get(groups[groups.length - 1])).toBe(DEFAULT_PALETTE.swatches[0]);
  });

  it("is deterministic for the same input", () => {
    const first = buildSwatchMap({ groups: ["a", "b"], palette: DEFAULT_PALETTE });
    const second = buildSwatchMap({ groups: ["a", "b"], palette: DEFAULT_PALETTE });
    expect([...first]).toEqual([...second]);
  });
});

describe("swatchFor", () => {
  const swatches = buildSwatchMap({ groups: ["known"], palette: DEFAULT_PALETTE });

  type Case = { name: string; group?: string; expected: unknown };
  const cases: Case[] = [
    { name: "ungrouped nodes use the neutral swatch", group: undefined, expected: DEFAULT_PALETTE.neutral },
    { name: "unknown groups fall back to neutral", group: "other", expected: DEFAULT_PALETTE.neutral },
    { name: "known groups use their swatch", group: "known", expected: DEFAULT_PALETTE.swatches[0] },
  ];

  it.each(cases)("$name", ({ group, expected }) => {
    expect(swatchFor({ group, swatches, palette: DEFAULT_PALETTE })).toBe(expected);
  });
});
