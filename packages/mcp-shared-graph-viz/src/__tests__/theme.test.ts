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
