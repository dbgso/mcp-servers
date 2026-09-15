/**
 * `kroki_render`, which is the half of this server that talks to the network.
 *
 * None of it had a test: not the unknown-tool guard, not the error Kroki
 * returns for a diagram it cannot parse, and not the three output shapes --
 * SVG as text, PNG/PDF as base64, or either written to a file. The last one is
 * the interesting one, because a caller passing `output_path` gets a
 * confirmation rather than the diagram, and returning the wrong one means
 * megabytes of base64 in a tool response or a file nobody wrote.
 *
 * `fetch` is stubbed throughout. The point of these tests is what this handler
 * does with a response, not that Kroki is reachable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { KrokiRenderHandler } from "../tools/handlers/render.js";
import { KrokiDescribeHandler } from "../tools/handlers/describe.js";
import { getToolRegistry } from "../tools/registry.js";
import { allOperations, getOperation } from "../operations/registry.js";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>';

let dir: string;
const handler = new KrokiRenderHandler();

const text = (r: { content: { type: string; text?: string }[] }) =>
  r.content.map((c) => c.text ?? "").join("\n");

/** A `fetch` that answers once with the given response. */
function respondWith(response: Partial<Response> & { okText?: string; bytes?: Uint8Array }) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    text: async () => response.okText ?? "",
    arrayBuffer: async () => (response.bytes ?? new Uint8Array()).buffer,
    url,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kroki-render-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.KROKI_URL;
  await rm(dir, { recursive: true, force: true });
});

describe("the tool name", () => {
  it("is checked before anything is sent", async () => {
    // A typo must not become a request to a URL path that does not exist, and
    // the answer has to name what is available instead.
    const fetchMock = respondWith({});

    const result = await handler.execute({ tool: "mermaidd", diagram: "graph TD; a-->b" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("mermaid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what it asks Kroki for", () => {
  it("posts the diagram to the tool and format path", async () => {
    const fetchMock = respondWith({ okText: SVG });

    await handler.execute({ tool: "mermaid", diagram: "graph TD; a-->b", format: "svg" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://kroki.io/mermaid/svg",
      expect.objectContaining({
        method: "POST",
        body: "graph TD; a-->b",
        headers: { "Content-Type": "text/plain" },
      })
    );
  });

  it("uses a self-hosted Kroki when one is configured", async () => {
    // The public instance sees the diagram; an internal one is how a caller
    // keeps it in-house, so this is the setting that must not be ignored.
    process.env.KROKI_URL = "http://kroki.internal:8000";
    const fetchMock = respondWith({ okText: SVG });

    await handler.execute({ tool: "plantuml", diagram: "@startuml\n@enduml" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://kroki.internal:8000/plantuml/svg");
  });
});

describe("an SVG response", () => {
  it("comes back as text", async () => {
    respondWith({ okText: SVG });

    const result = await handler.execute({ tool: "mermaid", diagram: "graph TD; a-->b" });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toBe(SVG);
  });

  it("is written to the path asked for, and the response says so instead", async () => {
    respondWith({ okText: SVG });
    const outputPath = join(dir, "diagram.svg");

    const result = await handler.execute({
      tool: "mermaid",
      diagram: "graph TD; a-->b",
      output_path: outputPath,
    });

    expect(text(result)).toBe(`Saved to ${outputPath}`);
    expect(await readFile(outputPath, "utf-8")).toBe(SVG);
  });
});

describe("a binary response", () => {
  it.each([
    { format: "png" as const, mimeType: "image/png" },
    { format: "pdf" as const, mimeType: "application/pdf" },
  ])("comes back as base64 $format with its own mime type", async ({ format, mimeType }) => {
    respondWith({ bytes: new Uint8Array([1, 2, 3, 4]) });

    const result = await handler.execute({
      tool: "mermaid",
      diagram: "graph TD; a-->b",
      format,
    });

    expect(result.content[0]).toEqual({
      type: "image",
      data: Buffer.from([1, 2, 3, 4]).toString("base64"),
      mimeType,
    });
  });

  it("is written as bytes, not as base64 text", async () => {
    // A PNG saved through the text path is a corrupt file that still opens in
    // an editor, which is the kind of failure nobody notices until later.
    respondWith({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
    const outputPath = join(dir, "diagram.png");

    const result = await handler.execute({
      tool: "mermaid",
      diagram: "graph TD; a-->b",
      format: "png",
      output_path: outputPath,
    });

    expect(text(result)).toBe(`Saved to ${outputPath}`);
    const written = await readFile(outputPath);
    expect([...written]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe("when the render fails", () => {
  it("reports the status and the body Kroki sent", async () => {
    // Kroki puts the parse error in the body, and that is the only thing that
    // tells the caller which line of their diagram is wrong.
    respondWith({ ok: false, status: 400, okText: "Syntax error at line 2" });

    const result = await handler.execute({ tool: "mermaid", diagram: "graph TD; ???" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("400");
    expect(text(result)).toContain("Syntax error at line 2");
  });

  it("reports a network failure rather than throwing out of the tool", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );

    const result = await handler.execute({ tool: "mermaid", diagram: "graph TD; a-->b" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("ECONNREFUSED");
  });

  it("reports a write that fails", async () => {
    respondWith({ okText: SVG });

    const result = await handler.execute({
      tool: "mermaid",
      diagram: "graph TD; a-->b",
      output_path: join(dir, "no-such-directory", "diagram.svg"),
    });

    expect(result.isError).toBe(true);
  });
});

describe("kroki_describe", () => {
  it("answers the overview with no arguments", async () => {
    const result = await new KrokiDescribeHandler().execute({});

    expect(text(result)).toMatch(/mermaid/);
  });

  it("answers for one tool", async () => {
    const result = await new KrokiDescribeHandler().execute({ tool: "d2" });

    expect(text(result)).toMatch(/d2|D2/);
  });
});

describe("kroki_describe for one sub-diagram", () => {
  it("answers from the tool's own guideline module when it has one", async () => {
    // mermaid, plantuml and d2 each ship a hand-written guide; those take
    // precedence over the generic registry text.
    const result = await new KrokiDescribeHandler().execute({
      tool: "mermaid",
      subDiagram: "flowchart",
    });

    expect(text(result)).toContain("Flowchart Syntax");
  });

  it("builds the answer from the registry for a tool with no guideline module", async () => {
    // graphviz is described by its registry entry alone, which is the path
    // that assembles the example and the best practices generically.
    const result = await new KrokiDescribeHandler().execute({
      tool: "graphviz",
      subDiagram: "digraph",
    });

    expect(text(result)).toContain("### Example");
    expect(text(result)).toContain("### Best Practices");
  });

  it("names the sub-diagrams it does have when asked for one it does not", async () => {
    const result = await new KrokiDescribeHandler().execute({
      tool: "graphviz",
      subDiagram: "nonesuch",
    });

    expect(text(result)).toContain("Unknown sub-diagram");
    expect(text(result)).toContain("digraph");
  });

  it("falls back to general advice for a tool with no practices of its own", async () => {
    // A tool added to the registry without a best-practices entry must still
    // answer, or `describe` fails for the new tool rather than saying less.
    const result = await new KrokiDescribeHandler().execute({
      tool: "excalidraw",
      subDiagram: "sketch",
    });

    expect(text(result)).toMatch(/Unknown sub-diagram|Keep diagrams simple/);
  });
});

describe("the operation registry", () => {
  it("resolves its one operation by id", () => {
    expect(allOperations.map((op) => op.id)).toEqual(["list"]);
    expect(getOperation("list")).toBeDefined();
  });

  it("returns nothing for an id it does not have", () => {
    expect(getOperation("nonesuch")).toBeUndefined();
  });
});

describe("the registry", () => {
  it("holds both tools and hands back the same instance", () => {
    const registry = getToolRegistry();

    expect(registry.getAllTools().map((t) => t.name).sort()).toEqual([
      "kroki_describe",
      "kroki_render",
    ]);
    expect(getToolRegistry()).toBe(registry);
  });
});
