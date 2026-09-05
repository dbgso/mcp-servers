import { describe, expect, it } from "vitest";

import { prepareGraph } from "../elements.js";
import { buildCytoscapeStyle, DEFAULT_CYTOSCAPE_URL, renderHtml } from "../html.js";
import type { GraphInput } from "../types.js";

const graph: GraphInput = {
  nodes: [
    { id: "a", label: "Alpha", group: "one" },
    { id: "b", label: "Beta", group: "two" },
  ],
  edges: [{ source: "a", target: "b" }],
};

/** Read the JSON assigned to a top-level `var` in the generated page. */
function readEmbedded(params: { html: string; name: string }): unknown {
  const { html, name } = params;
  const match = new RegExp(`var ${name} = (.*);\\n`).exec(html);
  if (match === null) {
    throw new Error(`no embedded ${name} found`);
  }
  return JSON.parse(match[1]);
}

describe("buildCytoscapeStyle", () => {
  it("adds a per-node rule carrying the group swatch", () => {
    const style = buildCytoscapeStyle({ prepared: prepareGraph({ graph }) });
    const selectors = style.map((rule) => (rule as { selector: string }).selector);
    expect(selectors).toContain('node[id = "a"]');
    expect(selectors).toContain('node[id = "b"]');
  });

  it("always includes base node and edge rules", () => {
    const style = buildCytoscapeStyle({ prepared: prepareGraph({ graph: { nodes: [], edges: [] } }) });
    expect(style.map((rule) => (rule as { selector: string }).selector)).toEqual(["node", "edge"]);
  });
});

describe("renderHtml", () => {
  it("is a complete document", () => {
    const html = renderHtml({ graph });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("loads cytoscape from the default CDN", () => {
    expect(renderHtml({ graph })).toContain(DEFAULT_CYTOSCAPE_URL);
  });

  it("accepts a caller-supplied cytoscape URL", () => {
    expect(renderHtml({ graph, cytoscapeUrl: "https://example.com/cy.js" })).toContain(
      "https://example.com/cy.js",
    );
  });

  it("loads dagre only when the dagre layout is used", () => {
    expect(renderHtml({ graph, layout: { name: "dagre" } })).toContain("cytoscape-dagre");
    expect(renderHtml({ graph, layout: { name: "cose" } })).not.toContain("cytoscape-dagre");
  });

  it("embeds every node and edge", () => {
    const elements = readEmbedded({ html: renderHtml({ graph }), name: "elements" }) as {
      group: string;
    }[];
    expect(elements.filter((element) => element.group === "nodes")).toHaveLength(2);
    expect(elements.filter((element) => element.group === "edges")).toHaveLength(1);
  });

  /** The browser can measure its own container, so the headless box must go. */
  it("drops the headless bounding box and lets the browser fit", () => {
    const layout = readEmbedded({
      html: renderHtml({ graph, layout: { name: "grid" } }),
      name: "layout",
    }) as Record<string, unknown>;
    expect(layout.boundingBox).toBeUndefined();
    expect(layout.fit).toBe(true);
  });

  it("renders the title and legend", () => {
    const html = renderHtml({ graph, title: "Topics" });
    expect(html).toContain("<h1>Topics</h1>");
    expect(html).toContain(">one</span>");
    expect(html).toContain(">two</span>");
  });

  it("omits the heading when no title is given", () => {
    expect(renderHtml({ graph })).not.toContain("<h1>");
  });

  it("cannot be broken out of by a label containing markup", () => {
    const hostile: GraphInput = {
      nodes: [{ id: "a", label: "</script><script>alert(1)</script>" }],
      edges: [],
    };
    const html = renderHtml({ graph: hostile });
    const scriptOpens = html.match(/<script/g) ?? [];
    const scriptCloses = html.match(/<\/script>/g) ?? [];
    expect(scriptOpens).toHaveLength(scriptCloses.length);
    expect(html).not.toContain("alert(1)</script>");
  });

  it("escapes a hostile title into the document title and heading", () => {
    const html = renderHtml({ graph, title: "<img onerror=x>" });
    expect(html).not.toContain("<img onerror=x>");
    expect(html).toContain("&lt;img onerror=x&gt;");
  });
});
