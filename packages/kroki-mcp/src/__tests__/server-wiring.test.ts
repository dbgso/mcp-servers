/**
 * The server's tool routing, over a real MCP connection.
 *
 * Every call arrives through the two request handlers in `server.ts`, and the
 * file was at 0%: the tests drive the handler classes directly. What is only
 * here is the wiring -- that the advertised list is the registry's, and that an
 * unknown name comes back as an error rather than as a crash.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../server.js";

/** A client joined to the server over a paired in-memory transport. */
async function connected(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("the advertised tools", () => {
  it("are the describe and render pair", async () => {
    const client = await connected();

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(["kroki_describe", "kroki_render"]);
    await client.close();
  });
});

describe("calling a tool", () => {
  it("reaches the handler the name belongs to", async () => {
    const client = await connected();

    const result = await client.callTool({ name: "kroki_describe", arguments: {} });

    expect(JSON.stringify(result.content)).toContain("mermaid");
    await client.close();
  });

  it("says which name it does not know", async () => {
    const client = await connected();

    const result = await client.callTool({ name: "kroki_nonesuch", arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("kroki_nonesuch");
    await client.close();
  });
});

describe("starting the server", () => {
  afterEach(() => {
    vi.doUnmock("@modelcontextprotocol/sdk/server/stdio.js");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("connects a stdio transport and says so on stderr", async () => {
    // stdout carries the JSON-RPC stream, so the banner has to go to stderr
    // or it corrupts the first message.
    const started: string[] = [];
    vi.resetModules();
    vi.doMock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
      StdioServerTransport: class {
        onmessage?: unknown;
        onclose?: unknown;
        onerror?: unknown;
        async start(): Promise<void> {
          started.push("start");
        }
        async send(): Promise<void> {}
        async close(): Promise<void> {}
      },
    }));
    const banner = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startServer } = await import("../server.js");

    await startServer();

    expect(started).toEqual(["start"]);
    expect(banner.mock.calls[0]?.[0]).toContain("kroki-mcp");
  });
});
