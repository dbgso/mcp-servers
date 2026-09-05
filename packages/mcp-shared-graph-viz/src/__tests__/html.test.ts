import { describe, expect, it } from "vitest";

import { prepareGraph } from "../elements.js";
import { GraphVizError } from "../errors.js";
import {
  buildCytoscapeStyle,
  DEFAULT_CYTOSCAPE_URL,
  DEFAULT_DAGRE_URLS,
  MAX_LABEL_WIDTH_PX,
  renderHtml,
} from "../html.js";
import { resolveTheme } from "../theme.js";
import type { GraphInput } from "../types.js";

const graph: GraphInput = {
  nodes: [
    { id: "a", label: "Alpha", group: "one" },
    { id: "b", label: "Beta", group: "two" },
  ],
  edges: [{ source: "a", target: "b" }],
};

const theme = resolveTheme({ theme: undefined });

/** Read the JSON assigned to a `var` in the generated page. */
function readEmbedded(params: { html: string; name: string }): unknown {
  const { html, name } = params;
  const match = new RegExp(`var ${name} = (.*);\\n`).exec(html);
  if (match === null) {
    throw new Error(`no embedded ${name} found`);
  }
  return JSON.parse(match[1]);
}

function selectorsOf(params: { style: unknown[] }): string[] {
  return params.style.map((rule) => (rule as { selector: string }).selector);
}

describe("buildCytoscapeStyle", () => {
  /** The browser can measure text; this library cannot, so sizing stays there. */
  it("sizes nodes from their label", () => {
    const style = buildCytoscapeStyle({ prepared: prepareGraph({ graph }), theme });
    const base = style[0] as { style: Record<string, unknown> };
    expect(base.style.width).toBe("label");
    expect(base.style.height).toBe("label");
    expect(base.style["text-max-width"]).toBe(`${MAX_LABEL_WIDTH_PX}px`);
  });

  it("lets a fixed size win over label sizing", () => {
    const style = buildCytoscapeStyle({ prepared: prepareGraph({ graph }), theme });
    const selectors = selectorsOf({ style });
    expect(selectors.indexOf("node[width]")).toBeGreaterThan(selectors.indexOf("node"));
    expect(selectors).toContain("node[height]");
  });

  it("adds a per-node rule carrying the group swatch and shape", () => {
    const style = buildCytoscapeStyle({ prepared: prepareGraph({ graph }), theme });
    const selectors = selectorsOf({ style });
    expect(selectors).toContain('node[id = "a"]');
    expect(selectors).toContain('node[id = "b"]');
    const rule = style.find(
      (entry) => (entry as { selector: string }).selector === 'node[id = "a"]',
    ) as { style: Record<string, unknown> };
    expect(rule.style.shape).toBe("round-rectangle");
    expect(rule.style["background-color"]).toBe(theme.palette.swatches[0].fill);
  });

  it("draws an arrow only on directed edges", () => {
    const style = buildCytoscapeStyle({ prepared: prepareGraph({ graph }), theme });
    expect(selectorsOf({ style })).toContain("edge[?directed]");
  });

  it("always includes the base rules", () => {
    const style = buildCytoscapeStyle({
      prepared: prepareGraph({ graph: { nodes: [], edges: [] } }),
      theme,
    });
    expect(selectorsOf({ style })).toEqual([
      "node",
      "node[width]",
      "node[height]",
      ":parent",
      "edge",
      "edge[?directed]",
      ".faded",
    ]);
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

  it("accepts caller-supplied script URLs", () => {
    const html = renderHtml({
      graph,
      cytoscapeUrl: "https://example.com/cy.js",
      dagreUrls: ["https://example.com/dagre.js"],
    });
    expect(html).toContain("https://example.com/cy.js");
    expect(html).toContain("https://example.com/dagre.js");
  });

  it("loads dagre only for the dagre layout", () => {
    expect(renderHtml({ graph, layout: { name: "dagre" } })).toContain(DEFAULT_DAGRE_URLS[1]);
    expect(renderHtml({ graph, layout: { name: "cose" } })).not.toContain(DEFAULT_DAGRE_URLS[1]);
  });

  it("embeds every node and edge", () => {
    const elements = readEmbedded({ html: renderHtml({ graph }), name: "elements" }) as {
      group: string;
    }[];
    expect(elements.filter((element) => element.group === "nodes")).toHaveLength(2);
    expect(elements.filter((element) => element.group === "edges")).toHaveLength(1);
  });

  it("embeds the layout the caller asked for", () => {
    const layout = readEmbedded({
      html: renderHtml({ graph, layout: { name: "grid" } }),
      name: "layout",
    }) as Record<string, unknown>;
    expect(layout).toMatchObject({ name: "grid", fit: true });
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

  it("omits the legend on request", () => {
    expect(renderHtml({ graph, legend: false })).not.toContain(">one</span>");
  });

  it("omits the legend when nothing is grouped", () => {
    const ungrouped: GraphInput = { nodes: [{ id: "a" }], edges: [] };
    expect(renderHtml({ graph: ungrouped })).not.toContain('class="legend"');
  });

  it("renders an empty graph without throwing", () => {
    expect(renderHtml({ graph: { nodes: [], edges: [] } }).startsWith("<!doctype html>")).toBe(true);
  });

  it("surfaces a caller mapping mistake as an error", () => {
    expect(() =>
      renderHtml({ graph: { nodes: [{ id: "a" }], edges: [{ source: "a", target: "ghost" }] } }),
    ).toThrow(GraphVizError);
  });

  it("refuses preset when a node has no position", () => {
    expect(() => renderHtml({ graph, layout: { name: "preset" } })).toThrow(
      /"preset" layout requires a position on every node/,
    );
  });

  it("accepts preset when every node has a position", () => {
    const positioned: GraphInput = {
      nodes: [
        { id: "a", position: { x: 0, y: 0 } },
        { id: "b", position: { x: 100, y: 40 } },
      ],
      edges: [{ source: "a", target: "b" }],
    };
    const layout = readEmbedded({
      html: renderHtml({ graph: positioned, layout: { name: "preset" } }),
      name: "layout",
    }) as Record<string, unknown>;
    expect(layout.positions).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: 40 } });
  });

  it("cannot be broken out of by a label containing markup", () => {
    const hostile: GraphInput = {
      nodes: [{ id: "a", label: "</script><script>alert(1)</script>" }],
      edges: [],
    };
    const html = renderHtml({ graph: hostile });
    expect(html.match(/<script/g) ?? []).toHaveLength((html.match(/<\/script>/g) ?? []).length);
    expect(html).not.toContain("alert(1)</script>");
  });

  it("escapes a hostile title", () => {
    const html = renderHtml({ graph, title: "<img onerror=x>" });
    expect(html).not.toContain("<img onerror=x>");
    expect(html).toContain("&lt;img onerror=x&gt;");
  });

  it("exposes the cytoscape instance so the page can be extended", () => {
    expect(renderHtml({ graph })).toContain("window.graphViz = { cy: cy }");
  });

  it("dims everything outside the hovered node's neighbourhood", () => {
    const html = renderHtml({ graph });
    expect(html).toContain("closedNeighborhood()");
    expect(html).toContain('addClass("faded")');
    expect(html).toContain('removeClass("faded")');
  });

  it("opens a node's href in a new tab without leaking the opener", () => {
    expect(renderHtml({ graph })).toContain('window.open(href, "_blank", "noopener")');
  });

  it("escapes a hostile script URL", () => {
    const html = renderHtml({ graph, cytoscapeUrl: '"></script><script>alert(1)</script>' });
    expect(html).not.toContain('"></script><script>alert(1)');
  });
});
