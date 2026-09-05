import { describe, expect, it } from "vitest";

import { escapeScriptJson, escapeXml, num } from "../svg/escape.js";
import { estimateTextWidth } from "../measure.js";
import { DEFAULT_PALETTE, resolveTheme } from "../theme.js";
import {
  arrowOrigin,
  computeSvgMetrics,
  edgeLabelPosition,
  edgePathData,
  layoutLegendRows,
  renderEdge,
  renderNode,
  renderSvg,
  shouldDrawLegend,
} from "../svg/render.js";
import type { LaidOutEdge, LaidOutGraph, LaidOutNode } from "../types.js";

const swatch = DEFAULT_PALETTE.swatches[0];
const theme = resolveTheme({ theme: undefined });

function node(overrides: Partial<LaidOutNode> = {}): LaidOutNode {
  return {
    id: "a",
    label: "Alpha",
    lines: ["Alpha"],
    x: 100,
    y: 50,
    width: 80,
    height: 40,
    shape: "roundRect",
    swatch,
    ...overrides,
  };
}

function edge(overrides: Partial<LaidOutEdge> = {}): LaidOutEdge {
  return {
    id: "e",
    source: "a",
    target: "b",
    directed: true,
    sourcePoint: { x: 0, y: 0 },
    targetPoint: { x: 100, y: 0 },
    controlPoints: [],
    ...overrides,
  };
}

function graph(overrides: Partial<LaidOutGraph> = {}): LaidOutGraph {
  return {
    nodes: [node()],
    edges: [],
    bounds: { x: 60, y: 30, width: 80, height: 40 },
    groups: [],
    ...overrides,
  };
}

describe("escapeXml", () => {
  type Case = { name: string; text: string; expected: string };
  const cases: Case[] = [
    { name: "ampersand first", text: "a & b", expected: "a &amp; b" },
    { name: "angle brackets", text: "<tag>", expected: "&lt;tag&gt;" },
    { name: "quotes", text: `"x" 'y'`, expected: "&quot;x&quot; &apos;y&apos;" },
    { name: "plain text is untouched", text: "plain", expected: "plain" },
  ];

  it.each(cases)("$name", ({ text, expected }) => {
    expect(escapeXml({ text })).toBe(expected);
  });
});

describe("escapeScriptJson", () => {
  it("neutralises a closing script tag", () => {
    const encoded = escapeScriptJson({ value: { html: "</script><script>alert(1)</script>" } });
    expect(encoded).not.toContain("</script>");
    expect(JSON.parse(encoded)).toEqual({ html: "</script><script>alert(1)</script>" });
  });

  it("escapes line and paragraph separators", () => {
    const encoded = escapeScriptJson({ value: "a b c" });
    expect(encoded).not.toContain(" ");
    expect(encoded).not.toContain(" ");
    expect(JSON.parse(encoded)).toBe("a b c");
  });
});

describe("num", () => {
  type Case = { value: number; expected: string };
  const cases: Case[] = [
    { value: 10, expected: "10" },
    { value: 10.5, expected: "10.50" },
    { value: -3.14159, expected: "-3.14" },
  ];

  it.each(cases)("$value -> $expected", ({ value, expected }) => {
    expect(num({ value })).toBe(expected);
  });
});

describe("computeSvgMetrics", () => {
  it("adds padding on both sides and shifts content into view", () => {
    const metrics = computeSvgMetrics({ graph: graph(), padding: 10, titleHeight: 0, legendHeight: 0 });
    expect(metrics).toMatchObject({ width: 100, height: 60, offsetX: -50, offsetY: -20 });
  });

  it("reserves space for the title and legend", () => {
    const metrics = computeSvgMetrics({ graph: graph(), padding: 10, titleHeight: 30, legendHeight: 20 });
    expect(metrics.height).toBe(60 + 30 + 20);
    expect(metrics.offsetY).toBe(10 + 30 - 30);
  });
});

describe("shouldDrawLegend", () => {
  type Case = { name: string; groups: { name: string; swatch: typeof swatch }[]; legend?: boolean; expected: boolean };
  const cases: Case[] = [
    { name: "no groups means no legend", groups: [], legend: undefined, expected: false },
    { name: "no groups even when asked", groups: [], legend: true, expected: false },
    { name: "groups default to showing", groups: [{ name: "g", swatch }], legend: undefined, expected: true },
    { name: "explicitly disabled", groups: [{ name: "g", swatch }], legend: false, expected: false },
  ];

  it.each(cases)("$name", ({ groups, legend, expected }) => {
    expect(shouldDrawLegend({ graph: graph({ groups }), legend })).toBe(expected);
  });
});

describe("layoutLegendRows", () => {
  it("keeps entries on one row when they fit", () => {
    const rows = layoutLegendRows({
      labels: ["a", "b"],
      availableWidth: 1000,
      fontSize: 12,
      measure: estimateTextWidth,
    });
    expect(rows).toEqual([["a", "b"]]);
  });

  it("wraps onto more rows when they do not", () => {
    const rows = layoutLegendRows({
      labels: ["alpha", "beta", "gamma"],
      availableWidth: 60,
      fontSize: 12,
      measure: estimateTextWidth,
    });
    expect(rows.length).toBeGreaterThan(1);
  });

  it("returns nothing for no labels", () => {
    expect(
      layoutLegendRows({ labels: [], availableWidth: 100, fontSize: 12, measure: estimateTextWidth }),
    ).toEqual([]);
  });
});

describe("renderNode", () => {
  type Case = { name: string; node: LaidOutNode; expected: RegExp };
  const cases: Case[] = [
    { name: "round rectangle", node: node(), expected: /<rect [^>]*rx="6"/ },
    { name: "plain rectangle", node: node({ shape: "rect" }), expected: /<rect [^>]*rx="0"/ },
    { name: "ellipse", node: node({ shape: "ellipse" }), expected: /<ellipse /},
    { name: "diamond", node: node({ shape: "diamond" }), expected: /<polygon /},
  ];

  it.each(cases)("renders a $name", ({ node: subject, expected }) => {
    expect(renderNode({ node: subject, theme })).toMatch(expected);
  });

  it("emits one tspan per line", () => {
    const markup = renderNode({ node: node({ lines: ["one", "two"] }), theme });
    expect(markup.match(/<tspan/g)).toHaveLength(2);
  });

  it("wraps the node in a link when href is set", () => {
    const markup = renderNode({ node: node({ href: "https://example.com/a?x=1&y=2" }), theme });
    expect(markup.startsWith("<a href=")).toBe(true);
    expect(markup).toContain("&amp;y=2");
  });

  it("adds a title element for the tooltip", () => {
    expect(renderNode({ node: node({ tooltip: "hint" }), theme })).toContain("<title>hint</title>");
  });

  it("escapes the label", () => {
    expect(renderNode({ node: node({ lines: ["<b>"] }), theme })).toContain("&lt;b&gt;");
  });
});

describe("edgePathData", () => {
  type Case = { name: string; edge: LaidOutEdge; expected: RegExp };
  const cases: Case[] = [
    { name: "straight line", edge: edge(), expected: /^M 0 0 L 100 0$/ },
    {
      name: "single control point becomes a quadratic",
      edge: edge({ controlPoints: [{ x: 50, y: 20 }] }),
      expected: /^M 0 0 Q 50 20 100 0$/,
    },
    {
      name: "two control points become a cubic",
      edge: edge({ controlPoints: [{ x: 10, y: 20 }, { x: 90, y: 20 }] }),
      expected: /^M 0 0 C 10 20 90 20 100 0$/,
    },
  ];

  it.each(cases)("$name", ({ edge: subject, expected }) => {
    expect(edgePathData({ edge: subject, end: { x: 100, y: 0 } })).toMatch(expected);
  });
});

describe("arrowOrigin", () => {
  it("is the source point for a straight edge", () => {
    expect(arrowOrigin({ edge: edge() })).toEqual({ x: 0, y: 0 });
  });

  it("is the last control point for a curved edge", () => {
    const subject = edge({ controlPoints: [{ x: 10, y: 5 }, { x: 90, y: 5 }] });
    expect(arrowOrigin({ edge: subject })).toEqual({ x: 90, y: 5 });
  });
});

describe("edgeLabelPosition", () => {
  it("is the midpoint of a straight edge", () => {
    expect(edgeLabelPosition({ edge: edge() })).toEqual({ x: 50, y: 0 });
  });

  it("follows the curve of a bent edge", () => {
    const position = edgeLabelPosition({ edge: edge({ controlPoints: [{ x: 50, y: 40 }] }) });
    expect(position.y).toBeCloseTo(20, 5);
  });
});

describe("renderEdge", () => {
  it("draws an arrowhead for a directed edge", () => {
    const markup = renderEdge({ edge: edge(), theme, color: "#000" });
    expect(markup).toContain("<polygon");
  });

  it("omits the arrowhead for an undirected edge", () => {
    const markup = renderEdge({ edge: edge({ directed: false }), theme, color: "#000" });
    expect(markup).not.toContain("<polygon");
  });

  it("stops the line short of the arrow tip", () => {
    const markup = renderEdge({ edge: edge(), theme, color: "#000" });
    expect(markup).toContain("L 91 0");
  });

  it("renders a label with a backing plate for legibility", () => {
    const markup = renderEdge({ edge: edge({ label: "uses" }), theme, color: "#000" });
    expect(markup).toContain(">uses</text>");
    expect(markup).toContain("<rect");
  });
});

describe("renderSvg", () => {
  it("produces a self-contained document with no external references", () => {
    const svg = renderSvg({ graph: graph() });
    expect(svg.startsWith("<svg xmlns=")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toMatch(/<(script|image|use)\b/);
    expect(svg).not.toContain("http://127.0.0.1");
  });

  it("sizes the viewBox to the content plus padding", () => {
    const svg = renderSvg({ graph: graph(), padding: 10 });
    expect(svg).toContain('viewBox="0 0 100 60"');
  });

  it("draws a background by default and skips it on request", () => {
    expect(renderSvg({ graph: graph() })).toContain('<rect width="100%"');
    expect(renderSvg({ graph: graph(), theme: { drawBackground: false } })).not.toContain(
      '<rect width="100%"',
    );
  });

  it("includes the title when given", () => {
    expect(renderSvg({ graph: graph(), title: "Topics & links" })).toContain("Topics &amp; links");
  });

  it("draws a legend entry per group", () => {
    const svg = renderSvg({
      graph: graph({ groups: [{ name: "alpha", swatch }, { name: "beta", swatch }] }),
    });
    expect(svg).toContain(">alpha</text>");
    expect(svg).toContain(">beta</text>");
  });

  it("omits the legend when disabled", () => {
    const svg = renderSvg({ graph: graph({ groups: [{ name: "alpha", swatch }] }), legend: false });
    expect(svg).not.toContain(">alpha</text>");
  });

  it("renders an empty graph as a valid document", () => {
    const svg = renderSvg({ graph: graph({ nodes: [], bounds: { x: 0, y: 0, width: 0, height: 0 } }) });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("NaN");
  });

  it("renders edges and nodes inside the translated group", () => {
    const svg = renderSvg({ graph: graph({ edges: [edge()] }) });
    expect(svg).toContain('data-edge-id="e"');
    expect(svg).toContain('data-node-id="a"');
    expect(svg.indexOf('data-edge-id="e"')).toBeLessThan(svg.indexOf('data-node-id="a"'));
  });

  it("uses a caller-supplied measure function for the legend", () => {
    const svg = renderSvg({
      graph: graph({ groups: [{ name: "alpha", swatch }] }),
      measureLabel: () => 1,
    });
    expect(svg).toContain(">alpha</text>");
  });
});
