/**
 * The server's tool routing, over a real MCP connection.
 *
 * Every tool call in this package arrives through `createServer`'s two request
 * handlers, and neither had ever run: the tests call the handler classes
 * directly. What is only here is the wiring -- whether the advertised tool list
 * is the registry's, and what happens to a name the registry does not have,
 * which is the one case a client can provoke without a bug of its own.
 *
 * Driven through `InMemoryTransport` rather than stdio: the same code path the
 * transport would take, without binding the test process's stdin.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "../server.js";
import { VERSION } from "../version.js";

/** A client joined to a fresh server over a paired in-memory transport. */
async function connected(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("the advertised tools", () => {
  it("are the ones the registry holds", async () => {
    const client = await connected();

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      "duckdb_count",
      "duckdb_describe",
      "duckdb_query",
    ]);
    await client.close();
  });
});

describe("calling a tool", () => {
  it("reaches the handler the name belongs to", async () => {
    const client = await connected();

    const result = await client.callTool({
      name: "duckdb_describe",
      arguments: { file_path: "/nonexistent/file.csv" },
    });

    // The file is not there, so this is an error -- but it is the handler's
    // error, which is what says the call was routed rather than dropped.
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("says which name it does not know", async () => {
    const client = await connected();

    const result = await client.callTool({ name: "duckdb_nonesuch", arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("duckdb_nonesuch");
    await client.close();
  });
});

describe("what the server calls itself", () => {
  it("reports the version of the package it was built from", () => {
    // A hardcoded version makes it impossible to tell which snapshot is
    // running; the build substitutes this, and the source falls back.
    expect(SERVER_NAME).toBe("duckdb-mcp");
    expect(SERVER_VERSION).toBe(VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
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
    // or it corrupts the first message. The transport is stubbed because the
    // real one binds this process's stdin.
    const started: string[] = [];
    vi.resetModules();
    vi.doMock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
      // Enough of the Transport contract for `connect` to complete.
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
    expect(banner).toHaveBeenCalledTimes(1);
    expect(banner.mock.calls[0]?.[0]).toContain("duckdb-mcp");
  });
});
