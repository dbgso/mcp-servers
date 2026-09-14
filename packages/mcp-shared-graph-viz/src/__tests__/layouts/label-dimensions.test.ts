/**
 * Which layouts have to be told that a node's dimensions include its label.
 *
 * The flag is not what fixed issue #46 -- see
 * `renderers/html/label-sizing.test.ts` for the measurements -- but the
 * layouts descended from `layout-base` do read `layoutDimensions()`, and
 * without it they place a node's body without the padding around its label.
 */

import { describe, expect, it } from "vitest";

import { buildLayoutSpec, LAYOUTS } from "../../layouts/registry.js";
import type { LayoutName } from "../../types.js";

/** Everything built on `layout-base`, which defaults the option to false. */
const COSE_FAMILY: LayoutName[] = ["cose", "fcose", "cola", "cise", "avsdf"];

/** The layouts that read cytoscape's own measurements, or place geometrically. */
const OTHERS: LayoutName[] = [
  "dagre",
  "klay",
  "elk-layered",
  "elk-mrtree",
  "elk-stress",
  "grid",
  "circle",
  "concentric",
  "breadthfirst",
  "preset",
];

describe("nodeDimensionsIncludeLabels", () => {
  it.each(COSE_FAMILY)("is set for %s", (name) => {
    expect(buildLayoutSpec({ layout: { name } }).nodeDimensionsIncludeLabels).toBe(true);
  });

  it.each(OTHERS)("is left off %s", (name) => {
    expect(buildLayoutSpec({ layout: { name } }).nodeDimensionsIncludeLabels).toBeUndefined();
  });

  it("covers every layout the package has", () => {
    // A layout added to the cose family without declaring the flag is the way
    // this comes back, so the two lists together have to account for all of
    // them.
    expect([...COSE_FAMILY, ...OTHERS].sort()).toEqual(Object.keys(LAYOUTS).sort());
  });

  it("is declared by the layout, not by the caller", () => {
    // Otherwise every consumer has to know which family a layout belongs to.
    for (const name of COSE_FAMILY) {
      expect(LAYOUTS[name].sizesNodesByLabel).toBe(true);
    }
    for (const name of OTHERS) {
      expect(LAYOUTS[name].sizesNodesByLabel).toBe(false);
    }
  });
});
