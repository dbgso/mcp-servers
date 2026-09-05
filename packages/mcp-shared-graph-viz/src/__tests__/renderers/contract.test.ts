import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { htmlRenderer, HtmlRenderer } from "../../renderers/html/index.js";
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
        (value): value is Renderer<unknown> =>
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

/**
 * The point of moving a format's settings to construction: a caller that does
 * not know the format can still drive it through the shared signature.
 */
describe("polymorphism through the contract", () => {
  const graph = { nodes: [{ id: "a", label: "Alpha" }], edges: [] };

  it("holds renderers of any format in one map", () => {
    const registry: Record<string, Renderer> = { html: htmlRenderer };
    expect(registry.html.render({ graph })).toContain("<!doctype html>");
  });

  it("renders from the shared params alone", () => {
    const renderer: Renderer = htmlRenderer;
    const output = renderer.render({
      graph,
      layout: { name: "grid" },
      theme: { fontSize: 20 },
      title: "t",
      legend: false,
    });
    expect(output).toContain('"name":"grid"');
    expect(output).toContain("<h1>t</h1>");
  });

  it("settles what differs in the constructor", () => {
    const renderer = new HtmlRenderer({ cytoscapeUrl: "/vendor/cytoscape.js" });
    const output = renderer.render({ graph });
    expect(output).toContain("/vendor/cytoscape.js");
    expect(output).not.toContain("cdnjs.cloudflare.com/ajax/libs/cytoscape");
  });

  it("binds the layout's scripts too", () => {
    const renderer = new HtmlRenderer({ layoutScriptUrls: ["/vendor/dagre.js"] });
    expect(renderer.render({ graph })).toContain("/vendor/dagre.js");
  });

  it("defaults to the CDN when nothing is bound", () => {
    expect(new HtmlRenderer().render({ graph })).toContain("cdnjs.cloudflare.com");
  });
});
