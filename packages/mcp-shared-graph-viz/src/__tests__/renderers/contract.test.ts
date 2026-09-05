import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { htmlRenderer } from "../../renderers/html/index.js";
import type { Renderer } from "../../renderers/types.js";

const RENDERERS_DIR = "src/renderers";

/** Every directory under renderers/ is one output format. */
function rendererDirs(): string[] {
  return readdirSync(RENDERERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe("renderers/", () => {
  it("has a directory per output format", () => {
    expect(rendererDirs()).toEqual(["html"]);
  });

  /**
   * The seam is only real if every format actually goes through it. A future
   * format that exports a bare function instead of a Renderer fails here,
   * which is the point: the type alone would not have caught it.
   */
  it.each(rendererDirs().map((name) => ({ name })))(
    "$name exports a Renderer from its entry point",
    async ({ name }) => {
      const entry = join("..", "..", "renderers", name, "index.js");
      const module = (await import(entry)) as Record<string, unknown>;

      const renderers = Object.values(module).filter(
        (value): value is Renderer<never, unknown> =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as { format?: unknown }).format === "string" &&
          typeof (value as { render?: unknown }).render === "function",
      );

      expect(renderers).toHaveLength(1);
      expect(renderers[0].format).toBe(name);
    },
  );
});

describe("htmlRenderer", () => {
  it("names its format", () => {
    expect(htmlRenderer.format).toBe("html");
  });

  it("renders through the contract", () => {
    const output = htmlRenderer.render({
      graph: { nodes: [{ id: "a", label: "Alpha" }], edges: [] },
      title: "Through the contract",
    });
    expect(output.startsWith("<!doctype html>")).toBe(true);
    expect(output).toContain("Through the contract");
  });

  /** The common options are the ones every renderer will need. */
  it("accepts the shared render params", () => {
    const output = htmlRenderer.render({
      graph: { nodes: [{ id: "a", group: "g" }], edges: [] },
      layout: { name: "grid" },
      theme: { fontSize: 20 },
      title: "t",
      legend: false,
    });
    expect(output).toContain('"name":"grid"');
    expect(output).not.toContain(">g</span>");
  });
});
