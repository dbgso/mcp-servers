import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GraphVizError } from "../../errors.js";
import {
  buildLayoutSpec,
  DEFAULT_LAYOUT,
  FIT_PADDING,
  LAYOUTS,
  layoutNames,
  resolveLayout,
} from "../../layouts/index.js";
import type { LayoutName } from "../../types.js";

const names = layoutNames();

describe("LAYOUTS", () => {
  it("covers every layout name", () => {
    expect([...names].sort()).toEqual(
      [
        "avsdf",
        "breadthfirst",
        "circle",
        "cise",
        "cola",
        "concentric",
        "cose",
        "dagre",
        "elk-layered",
        "elk-mrtree",
        "elk-stress",
        "fcose",
        "grid",
        "klay",
        "preset",
      ].sort(),
    );
  });

  it.each(names.map((name) => ({ name })))("$name declares itself under its own key", ({ name }) => {
    expect(LAYOUTS[name].name).toBe(name);
  });

  it("loads scripts only over https", () => {
    for (const name of names) {
      for (const url of LAYOUTS[name].scriptUrls) {
        expect(url).toMatch(/^https:\/\//);
      }
    }
  });

  /** Pinned, so a CDN publishing a new major cannot change a rendered page. */
  it("pins every script to an exact version", () => {
    for (const name of names) {
      for (const url of LAYOUTS[name].scriptUrls) {
        expect(url).toMatch(/@\d+\.\d+\.\d+\/|\/\d+\.\d+\.\d+\//);
      }
    }
  });

  it("uses the built-in layouts without any script", () => {
    const builtIn = ["dagre", "cose", "concentric", "grid", "circle", "breadthfirst", "preset"];
    const withoutScripts = names.filter((name) => LAYOUTS[name].scriptUrls.length === 0);
    expect(withoutScripts.sort()).toEqual(
      builtIn.filter((name) => name !== "dagre").sort(),
    );
  });

  it("only preset needs positions", () => {
    const needing = names.filter((name) => LAYOUTS[name].requiresPositions);
    expect(needing).toEqual(["preset"]);
  });
});

describe("resolveLayout", () => {
  it("defaults to dagre", () => {
    expect(resolveLayout({ name: undefined }).name).toBe(DEFAULT_LAYOUT);
  });

  it("lists the available layouts when the name is unknown", () => {
    expect(() => resolveLayout({ name: "spiral" })).toThrow(GraphVizError);
    expect(() => resolveLayout({ name: "spiral" })).toThrow(
      /Unknown layout "spiral"\. Available layouts: /,
    );
  });
});

describe("buildLayoutSpec", () => {
  it("defaults to dagre", () => {
    expect(buildLayoutSpec({}).name).toBe("dagre");
  });

  /**
   * The browser measures its own container, so the layout fits to it. A
   * bounding box would override that and squash the result.
   */
  it.each(names.map((name) => ({ name })))("$name fits to the container", ({ name }) => {
    const spec = buildLayoutSpec({ layout: { name } });
    expect(spec).toMatchObject({ animate: false, fit: true, padding: FIT_PADDING });
    expect(spec.boundingBox).toBeUndefined();
  });

  /** cytoscape resolves the extension's name, which is not always ours. */
  it.each(names.map((name) => ({ name })))("$name names the layout cytoscape knows", ({ name }) => {
    expect(buildLayoutSpec({ layout: { name } }).name).toBe(LAYOUTS[name].cytoscapeName);
  });

  it("hands every elk algorithm to the one layout cytoscape registered", () => {
    for (const name of ["elk-layered", "elk-mrtree", "elk-stress"] as const) {
      expect(buildLayoutSpec({ layout: { name } }).name).toBe("elk");
    }
    expect(buildLayoutSpec({ layout: { name: "elk-mrtree" } }).elk).toMatchObject({
      algorithm: "mrtree",
    });
  });

  type SpacingCase = { name: LayoutName; key: string; atOne: number };
  const spacingCases: SpacingCase[] = [
    { name: "dagre", key: "nodeSep", atOne: 40 },
    { name: "dagre", key: "rankSep", atOne: 70 },
    { name: "cose", key: "nodeRepulsion", atOne: 12000 },
    { name: "cose", key: "idealEdgeLength", atOne: 90 },
    { name: "concentric", key: "minNodeSpacing", atOne: 30 },
  ];

  it.each(spacingCases)("$name scales $key with spacing", ({ name, key, atOne }) => {
    expect(buildLayoutSpec({ layout: { name } })[key]).toBe(atOne);
    expect(buildLayoutSpec({ layout: { name, spacing: 2 } })[key]).toBe(atOne * 2);
  });

  it("passes the direction through to dagre", () => {
    expect(buildLayoutSpec({ layout: { name: "dagre", direction: "LR" } }).rankDir).toBe("LR");
    expect(buildLayoutSpec({ layout: { name: "dagre" } }).rankDir).toBe("TB");
  });

  it("sets breadthfirst to directed", () => {
    expect(buildLayoutSpec({ layout: { name: "breadthfirst" } })).toMatchObject({
      directed: true,
      grid: true,
    });
  });

  it.each([{ name: "grid" as LayoutName }, { name: "circle" as LayoutName }])(
    "$name adds nothing beyond the shared base",
    ({ name }) => {
      expect(Object.keys(buildLayoutSpec({ layout: { name } })).sort()).toEqual(
        ["animate", "fit", "name", "padding", "spacingFactor"].sort(),
      );
    },
  );

  /** Element positions are not reliably read back, so preset carries its own. */
  it("hands preset its positions explicitly", () => {
    const spec = buildLayoutSpec({
      layout: { name: "preset" },
      positions: new Map([["a", { x: 1, y: 2 }]]),
    });
    expect(spec.positions).toEqual({ a: { x: 1, y: 2 } });
  });

  it("tolerates preset without any positions", () => {
    expect(buildLayoutSpec({ layout: { name: "preset" } }).positions).toEqual({});
  });
});

/**
 * The whole point of the registry: a layout's quirks live in its own module.
 * If this fails, something outside layouts/ started branching on a name again.
 */
describe("no layout knowledge leaks out of layouts/", () => {
  function sourceFiles(params: { dir: string }): string[] {
    const { dir } = params;
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "__tests__" || entry.name === "layouts" ? [] : sourceFiles({ dir: full });
      }
      return entry.name.endsWith(".ts") ? [full] : [];
    });
  }

  it.each(names.map((name) => ({ name })))("nothing compares against %s", ({ name }) => {
    const offenders = sourceFiles({ dir: "src" }).filter((file) =>
      new RegExp(`===\\s*["']${name}["']`).test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
