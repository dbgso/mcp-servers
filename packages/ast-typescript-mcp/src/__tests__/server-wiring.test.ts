/**
 * The server's tool routing, over a real MCP connection.
 *
 * `server.ts` was at 0%: every call arrives through its two request handlers,
 * and the suite drives the handler classes directly.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../server.js";

async function connected(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("the advertised tools", () => {
  it("are the ts_ast entry point", async () => {
    const client = await connected();

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toContain("ts_ast");
    await client.close();
  });
});

describe("calling a tool", () => {
  it("reaches the handler the name belongs to", async () => {
    const client = await connected();

    const result = await client.callTool({
      name: "ts_ast",
      arguments: { action: "nonesuch" },
    });

    // The action is refused by the handler, which is what says the call was
    // routed rather than dropped.
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("says which name it does not know", async () => {
    const client = await connected();

    const result = await client.callTool({ name: "ts_nonesuch", arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("ts_nonesuch");
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
    expect(banner.mock.calls[0]?.[0]).toContain("ast-typescript");
  });
});
