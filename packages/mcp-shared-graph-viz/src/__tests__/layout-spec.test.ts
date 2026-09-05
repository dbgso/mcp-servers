import { describe, expect, it } from "vitest";

import { GraphVizError } from "../errors.js";
import { buildLayoutSpec, FIT_PADDING } from "../layout-spec.js";
import type { LayoutName } from "../types.js";

const ALL_LAYOUTS: LayoutName[] = [
  "dagre",
  "cose",
  "concentric",
  "grid",
  "circle",
  "breadthfirst",
  "preset",
];

describe("buildLayoutSpec", () => {
  it("defaults to dagre", () => {
    expect(buildLayoutSpec({}).name).toBe("dagre");
  });

  it("rejects an unknown layout", () => {
    expect(() => buildLayoutSpec({ layout: { name: "spiral" as LayoutName } })).toThrow(GraphVizError);
  });

  /**
   * The browser measures its own container, so the layout fits to it. A
   * bounding box would override that and squash the result.
   */
  it.each(ALL_LAYOUTS.map((name) => ({ name })))("$name fits to the container", ({ name }) => {
    const spec = buildLayoutSpec({ layout: { name } });
    expect(spec.fit).toBe(true);
    expect(spec.padding).toBe(FIT_PADDING);
    expect(spec.boundingBox).toBeUndefined();
  });

  it.each(ALL_LAYOUTS.map((name) => ({ name })))("$name never animates", ({ name }) => {
    expect(buildLayoutSpec({ layout: { name } }).animate).toBe(false);
  });

  it("passes the direction through to dagre", () => {
    expect(buildLayoutSpec({ layout: { name: "dagre", direction: "LR" } }).rankDir).toBe("LR");
  });

  it("scales dagre separation with spacing", () => {
    const tight = buildLayoutSpec({ layout: { name: "dagre", spacing: 1 } });
    const loose = buildLayoutSpec({ layout: { name: "dagre", spacing: 2 } });
    expect(Number(loose.nodeSep)).toBe(Number(tight.nodeSep) * 2);
    expect(Number(loose.rankSep)).toBe(Number(tight.rankSep) * 2);
  });

  it("sets breadthfirst to directed", () => {
    expect(buildLayoutSpec({ layout: { name: "breadthfirst" } }).directed).toBe(true);
  });

  it("scales cose repulsion with spacing", () => {
    expect(buildLayoutSpec({ layout: { name: "cose", spacing: 2 } }).nodeRepulsion).toBe(24000);
  });

  it("sets concentric node spacing", () => {
    expect(buildLayoutSpec({ layout: { name: "concentric", spacing: 2 } }).minNodeSpacing).toBe(60);
  });

  /** Element positions are not reliably read back, so preset carries its own. */
  it("hands preset its positions explicitly", () => {
    const spec = buildLayoutSpec({
      layout: { name: "preset" },
      presetPositions: new Map([["a", { x: 1, y: 2 }]]),
    });
    expect(spec.positions).toEqual({ a: { x: 1, y: 2 } });
  });

  it("tolerates preset without any positions", () => {
    expect(buildLayoutSpec({ layout: { name: "preset" } }).positions).toEqual({});
  });
});
