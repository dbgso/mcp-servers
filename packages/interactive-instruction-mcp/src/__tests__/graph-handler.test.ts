/**
 * Turning `relatedDocs` into a drawable graph.
 *
 * The mapping is the part that belongs to this package; `mcp-shared-graph-viz`
 * only draws what it is handed. So most of what is worth testing is the shape
 * of the nodes and edges, with a couple of cases confirming the page is really
 * produced.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { MarkdownReader } from "../services/markdown-reader.js";
import { GraphHandler, buildGraph, LAYOUT_NAMES } from "../tools/instruction/handlers/graph.js";
import { layoutNames, LAYOUTS } from "mcp-shared-graph-viz";
import { DRAFT_DIR } from "../constants.js";
import type { MarkdownSummary } from "../types/index.js";

function doc(id: string, relatedDocs?: string[]): MarkdownSummary {
  return { id, description: `about ${id}`, relatedDocs };
}

describe("buildGraph", () => {
  const corpus = [
    doc("a", ["b"]),
    doc("b", ["c"]),
    doc("c"),
    doc("lonely"),
  ];

  it("draws one node per linked document and one edge per relation", () => {
    const { nodes, edges } = buildGraph({ documents: corpus, depth: 1, includeUnlinked: false });

    expect(nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(edges.map((e) => `${e.source}->${e.target}`)).toEqual(["a->b", "b->c"]);
  });

  it("leaves out documents with no relations", () => {
    const { nodes } = buildGraph({ documents: corpus, depth: 1, includeUnlinked: false });
    expect(nodes.map((n) => n.id)).not.toContain("lonely");
  });

  it("includes them when asked", () => {
    const { nodes } = buildGraph({ documents: corpus, depth: 1, includeUnlinked: true });
    expect(nodes.map((n) => n.id)).toContain("lonely");
  });

  it("draws a link to a document that does not exist rather than dropping it", () => {
    // Silently omitting a dangling reference would make a broken corpus look
    // intact, and finding those is a reason to open the graph at all.
    const { nodes, edges } = buildGraph({
      documents: [doc("a", ["ghost"])],
      depth: 1,
      includeUnlinked: false,
    });

    const ghost = nodes.find((n) => n.id === "ghost");
    expect(ghost?.group).toBe("(missing)");
    expect(ghost?.tooltip).toContain("does not exist");
    expect(edges).toHaveLength(1);
  });

  it("groups by the id's top-level category, so a category shares a colour", () => {
    const { nodes } = buildGraph({
      documents: [doc("git__workflow", ["git__commands"]), doc("git__commands")],
      depth: 1,
      includeUnlinked: false,
    });

    expect(nodes.every((n) => n.group === "git")).toBe(true);
  });

  it("carries the description as the tooltip", () => {
    const { nodes } = buildGraph({
      documents: [doc("a", ["b"]), doc("b")],
      depth: 1,
      includeUnlinked: false,
    });

    expect(nodes.find((n) => n.id === "a")?.tooltip).toBe("a — about a");
  });

  it("is stable: the same corpus produces the same nodes and edges in the same order", () => {
    const shuffled = [corpus[2], corpus[0], corpus[3], corpus[1]];

    expect(buildGraph({ documents: shuffled, depth: 1, includeUnlinked: false }))
      .toEqual(buildGraph({ documents: corpus, depth: 1, includeUnlinked: false }));
  });

  describe("focusing on one document", () => {
    // a -> b -> c -> d, plus an unrelated pair
    const chain = [doc("a", ["b"]), doc("b", ["c"]), doc("c", ["d"]), doc("d"), doc("x", ["y"]), doc("y")];

    it.each([
      [1, ["a", "b", "c"]],
      [2, ["a", "b", "c", "d"]],
      [3, ["a", "b", "c", "d"]],
    ])("depth %i reaches %j", (depth, expected) => {
      const { nodes } = buildGraph({ documents: chain, focusId: "b", depth, includeUnlinked: false });
      expect(nodes.map((n) => n.id)).toEqual(expected);
    });

    it("walks relations in both directions", () => {
      // `a` is only reachable from `b` by following the edge backwards. Being
      // referenced by a document is as much a relation as referencing one.
      const { nodes } = buildGraph({ documents: chain, focusId: "b", depth: 1, includeUnlinked: false });
      expect(nodes.map((n) => n.id)).toContain("a");
    });

    it("leaves out an unrelated component", () => {
      const { nodes } = buildGraph({ documents: chain, focusId: "b", depth: 3, includeUnlinked: false });
      expect(nodes.map((n) => n.id)).not.toContain("x");
    });
  });
});

describe("GraphHandler", () => {
  let tempDir: string;
  let docsDir: string;
  let reader: MarkdownReader;
  const handler = new GraphHandler();

  const write = (id: string, relatedDocs: string[]) =>
    fs.writeFile(
      path.join(docsDir, `${id}.md`),
      `---\ndescription: about ${id}\n${relatedDocs.length === 0 ? "" : `relatedDocs:\n${relatedDocs.map((r) => `  - ${r}`).join("\n")}\n`}---\n\n# ${id}`,
      "utf-8"
    );

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-handler-"));
    docsDir = path.join(tempDir, "docs");
    await fs.mkdir(path.join(docsDir, DRAFT_DIR), { recursive: true });
    reader = new MarkdownReader(docsDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("writes a page containing the documents", async () => {
    await write("alpha", ["beta"]);
    await write("beta", []);
    const outputPath = path.join(tempDir, "graph.html");

    const result = await handler.execute({
      rawParams: { action: "graph", outputPath },
      context: { reader },
    });

    expect(result.isError).toBeFalsy();
    const html = await fs.readFile(outputPath, "utf-8");
    expect(html).toContain("alpha");
    expect(html).toContain("beta");
    expect(html).toContain("<html");
  });

  it("reports where it wrote the page", async () => {
    await write("alpha", ["beta"]);
    await write("beta", []);
    const outputPath = path.join(tempDir, "graph.html");

    const result = await handler.execute({
      rawParams: { action: "graph", outputPath },
      context: { reader },
    });

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain(outputPath);
    expect(text).toContain("2 documents, 1 relations");
  });

  it("calls out links that point at nothing", async () => {
    await write("alpha", ["ghost"]);
    const outputPath = path.join(tempDir, "graph.html");

    const result = await handler.execute({
      rawParams: { action: "graph", outputPath },
      context: { reader },
    });

    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("do not exist");
    expect(text).toContain("ghost");
  });

  it("says so rather than writing an empty page when nothing is linked", async () => {
    await write("alpha", []);

    const result = await handler.execute({
      rawParams: { action: "graph", outputPath: path.join(tempDir, "graph.html") },
      context: { reader },
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(text).toContain("No relations to draw");
  });

  describe("colour stability", () => {
    const groupsOf = async (rawParams: Record<string, unknown>) => {
      const outputPath = path.join(tempDir, `graph-${Math.random()}.html`);
      await handler.execute({
        rawParams: { action: "graph", outputPath, ...rawParams },
        context: { reader },
      });
      const html = await fs.readFile(outputPath, "utf-8");
      const style = html.match(
        /node\[id = \\"a__one\\"\]","style":\{"background-color":"(#[0-9a-f]{6})"/,
      );
      return style?.[1];
    };

    it("keeps a group's colour between the corpus and a close-up", async () => {
      // The reported symptom: narrowing the view moved a document's colour,
      // because the palette index came from the groups that happened to show.
      await write("a__one", ["b__two"]);
      await write("b__two", ["c__three"]);
      await write("c__three", []);

      const whole = await groupsOf({});
      const closeUp = await groupsOf({ id: "a__one", depth: 1 });

      expect(whole).toBeDefined();
      expect(closeUp).toBe(whole);
    });
  });

  describe("format: text", () => {
    const asText = async (rawParams: Record<string, unknown>) => {
      const result = await handler.execute({
        rawParams: { action: "graph", format: "text", ...rawParams },
        context: { reader },
      });
      expect(result.isError).toBeFalsy();
      return result.content[0].type === "text" ? result.content[0].text : "";
    };

    it("writes one adjacency line per document that references anything", async () => {
      await write("alpha", ["beta", "gamma"]);
      await write("beta", ["gamma"]);
      await write("gamma", []);

      const text = await asText({});

      expect(text).toContain("alpha -> beta, gamma");
      expect(text).toContain("beta -> gamma");
      // gamma references nothing, so it gets no line of its own.
      expect(text).not.toMatch(/^gamma ->/m);
    });

    it("returns the graph instead of writing a file", async () => {
      await write("alpha", ["beta"]);
      await write("beta", []);
      const outputPath = path.join(tempDir, "graph.html");

      const text = await asText({ outputPath });

      expect(text).toContain("alpha -> beta");
      await expect(fs.access(outputPath)).rejects.toThrow();
    });

    it("answers both directions up front when focused", async () => {
      await write("hub", ["middle"]);
      await write("middle", ["leaf"]);
      await write("leaf", []);

      const text = await asText({ id: "middle", depth: 1 });

      expect(text).toContain("middle, depth 1");
      expect(text).toContain("referenced by: hub");
      expect(text).toContain("references: leaf");
    });

    it.each([
      ["referenced by", "root"],
      ["references", "tip"],
    ])("says (nothing) rather than leaving %s blank", async (label, focus) => {
      await write("root", ["tip"]);
      await write("tip", []);

      const text = await asText({ id: focus, depth: 1 });

      expect(text).toContain(`${label}: (nothing)`);
    });

    it("reaches further with depth", async () => {
      await write("a", ["b"]);
      await write("b", ["c"]);
      await write("c", ["d"]);
      await write("d", []);

      expect(await asText({ id: "b", depth: 1 })).not.toContain("c -> d");
      expect(await asText({ id: "b", depth: 2 })).toContain("c -> d");
    });

    it("calls out links that point at nothing", async () => {
      await write("alpha", ["ghost"]);

      const text = await asText({});

      expect(text).toContain("missing (referenced but not present): ghost");
    });

    it("names unlinked documents only when they were asked for", async () => {
      await write("alpha", ["beta"]);
      await write("beta", []);
      await write("lonely", []);

      expect(await asText({})).not.toContain("lonely");
      expect(await asText({ includeUnlinked: true })).toContain("unlinked (no relations either way): lonely");
    });
  });

  describe("keeping up with the renderer", () => {
    it("offers every layout the library has, apart from the one needing positions", () => {
      // The schema spells the names out to keep them literal types, so this is
      // what notices when the library gains or loses one.
      const offerable = layoutNames()
        .filter((name) => !LAYOUTS[name].requiresPositions)
        .sort();

      expect([...LAYOUT_NAMES].sort()).toEqual(offerable);
    });
  });

  describe("layout", () => {
    const render = async (rawParams: Record<string, unknown>) => {
      await write("alpha", ["beta"]);
      await write("beta", []);
      const outputPath = path.join(tempDir, "graph.html");
      await handler.execute({
        rawParams: { action: "graph", outputPath, ...rawParams },
        context: { reader },
      });
      return fs.readFile(outputPath, "utf-8");
    };

    it("draws top-to-bottom with dagre when nothing is asked for", async () => {
      const html = await render({});
      expect(html).toContain('"name":"dagre"');
      expect(html).toContain('rankDir":"TB"');
    });

    it.each([["LR"], ["RL"], ["BT"], ["TB"]])("passes direction %s to dagre", async (direction) => {
      const html = await render({ direction });
      expect(html).toContain(`rankDir":"${direction}"`);
    });

    it("passes spacing through", async () => {
      const html = await render({ spacing: 2 });
      expect(html).toContain("spacingFactor\":2");
    });

    it("still honours a named layout when a direction is also given", async () => {
      // breadthfirst ignores rankDir; naming it must not be overridden by direction.
      const html = await render({ layout: "breadthfirst", direction: "LR" });
      expect(html).toContain('"name":"breadthfirst"');
    });

    it.each([["taxi"], ["straight"], ["segments"], ["haystack"], ["bezier"]])(
      "passes edgeStyle %s to the renderer",
      async (edgeStyle) => {
        const html = await render({ edgeStyle });
        expect(html).toContain(`"curve-style":"${edgeStyle}"`);
      },
    );

    it.each([["fcose"], ["cola"], ["avsdf"], ["cise"], ["klay"]])(
      "accepts the layout %s the library gained",
      async (layout) => {
        const html = await render({ layout });
        expect(html).toContain(`"name":"${layout}"`);
      },
    );

    it.each([
      ["elk-layered", "layered"],
      ["elk-mrtree", "mrtree"],
      ["elk-stress", "stress"],
    ])("maps %s onto the elk layout's %s algorithm", async (layout, algorithm) => {
      // cytoscape-elk registers a single layout named "elk"; the variant this
      // handler offers is chosen by its algorithm, not by the layout name.
      const html = await render({ layout });
      expect(html).toContain(`"algorithm":"${algorithm}"`);
    });

    it("rejects a direction that is not a rank direction", async () => {
      const result = await handler.execute({
        rawParams: { action: "graph", direction: "sideways" },
        context: { reader },
      });
      expect(result.isError).toBeTruthy();
    });
  });

  it("rejects a focus on a document that does not exist", async () => {
    await write("alpha", ["beta"]);
    await write("beta", []);

    const result = await handler.execute({
      rawParams: { action: "graph", id: "nope" },
      context: { reader },
    });

    expect(result.isError).toBe(true);
  });

  it("keeps drafts out of the graph", async () => {
    await write("alpha", ["beta"]);
    await write("beta", []);
    await fs.writeFile(
      path.join(docsDir, DRAFT_DIR, "secret.md"),
      "---\ndescription: a draft\nrelatedDocs:\n  - alpha\n---\n\n# secret",
      "utf-8"
    );
    const outputPath = path.join(tempDir, "graph.html");

    await handler.execute({ rawParams: { action: "graph", outputPath }, context: { reader } });

    expect(await fs.readFile(outputPath, "utf-8")).not.toContain("secret");
  });
});
