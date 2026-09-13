/**
 * Issue #46: with the cose-family layouts, every node covered its neighbours
 * and no edge was visible -- on a corpus with 126 relations, which made it look
 * like a corpus with none.
 *
 * The cause was timing. Nodes are sized by their label (`width: label`), and
 * that is unresolved until cytoscape has rendered once and measured the text.
 * A layout passed to the constructor runs before that, sees `width` as zero,
 * and cytoscape caches `takesUpSpace()` as false for the rest of the page's
 * life -- so `layoutDimensions()` returns 1x1 for every node and the layout
 * places 350px-wide nodes 60px apart.
 *
 * Measured in a browser on a 93-node, 126-edge graph with long ids:
 *
 * | page                                    | overlapping pairs (of 4278) | worst overlap |
 * |---|---|---|
 * | as shipped                              | 456 | 87% of a node |
 * | `nodeDimensionsIncludeLabels: true`     | 437 | 93% |
 * | layout re-run after the first render    | 449 | 86% |
 * | nodes given their measured size         |  58 | 42% |
 *
 * So the assertions here are about *when* the layout runs and *what* the nodes
 * are sized by. The library cannot measure text, so it cannot assert the
 * geometry; what it can hold is the shape of the page that produced the last
 * row.
 */

import { describe, expect, it } from "vitest";

import { renderHtml } from "../../../renderers/html/index.js";
import type { GraphInput } from "../../../types.js";

const graph: GraphInput = {
  nodes: [
    { id: "testing__population-must-not-silently-become-zero", label: "testing__population-must-not-silently-become-zero" },
    { id: "workflow__plan-tool-required", label: "workflow__plan-tool-required" },
  ],
  edges: [{ source: "testing__population-must-not-silently-become-zero", target: "workflow__plan-tool-required" }],
};

/** The `cytoscape({...})` call, up to its closing brace. */
function constructorCall(html: string): string {
  const start = html.indexOf("cytoscape({");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("});", start));
}

describe("node sizing and layout timing", () => {
  it("does not lay out from the constructor", () => {
    const html = renderHtml({ graph, layout: { name: "fcose" } });

    // The whole bug: a layout here runs before any label has been measured.
    expect(constructorCall(html)).not.toContain("layout:");
  });

  it("runs the layout after the render that measures the labels", () => {
    const html = renderHtml({ graph, layout: { name: "fcose" } });

    expect(html).toContain('cy.one("render"');
    expect(html).toContain("cy.layout(layout).run()");
    // Belt and braces: a build that renders before this handler is attached
    // would never fire it.
    expect(html).toContain("requestAnimationFrame");
  });

  it("lays out exactly once", () => {
    // Both triggers can fire. Laying out twice would not be wrong on screen,
    // but it would double the work on every large graph.
    const html = renderHtml({ graph, layout: { name: "fcose" } });

    expect(html).toContain("if (laidOut)");
  });

  it("writes the measured label size onto each node", () => {
    const html = renderHtml({ graph, layout: { name: "fcose" } });

    expect(html).toContain('node.data("width", Math.ceil(node.width()))');
    expect(html).toContain('node.data("height", Math.ceil(node.height()))');
  });

  it("leaves a caller-supplied size alone", () => {
    // `node[width]` is the one rule both paths go through, so measuring over
    // the top of an explicit size would silently discard it.
    const html = renderHtml({ graph, layout: { name: "fcose" } });

    expect(html).toContain('node.data("width") === undefined');
    expect(html).toContain('node.data("height") === undefined');
  });

  it("still renders a layout that needs no scripts", () => {
    const html = renderHtml({ graph, layout: { name: "dagre" } });

    expect(constructorCall(html)).not.toContain("layout:");
    expect(html).toContain("cy.layout(layout).run()");
  });
});
