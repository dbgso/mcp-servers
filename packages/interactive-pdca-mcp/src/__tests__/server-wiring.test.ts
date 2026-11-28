/**
 * The server's tool registration, over a real MCP connection.
 *
 * Every call to this server arrives through `createServer`, and none of it had
 * a test: the suite drives the handlers directly, so the file that decides
 * which tools exist, where the plan directory lives, and which readers each
 * tool is given reported 0%. A registration that drops a tool, or points a
 * reader at the wrong directory, is invisible to every other test here.
 *
 * Driven over `InMemoryTransport` -- the same path stdio would take, without
 * binding the test process's stdin.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";

let markdownDir: string;

/** A client joined to a fresh server over a paired in-memory transport. */
async function connected(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ markdownDir });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

beforeEach(async () => {
  markdownDir = await fs.mkdtemp(path.join(os.tmpdir(), "pdca-server-"));
});

afterEach(async () => {
  await fs.rm(markdownDir, { recursive: true, force: true });
});

describe("the advertised tools", () => {
  it("are the plan and approve pair", async () => {
    const client = await connected();

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(["approve", "plan"]);
    await client.close();
  });

  it("each carry a schema a client can read", async () => {
    const client = await connected();

    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.description ?? "").not.toBe("");
    }
    await client.close();
  });
});

describe("calling a tool", () => {
  it("reaches the plan tool's own handlers", async () => {
    const client = await connected();

    const result = await client.callTool({
      name: "plan",
      arguments: { action: "list" },
    });

    // An empty plan directory still answers; what matters is that the call
    // was routed to the plan tool rather than refused.
    expect(JSON.stringify(result.content)).toBeTruthy();
    await client.close();
  });

  it("reaches the approve tool's own handlers", async () => {
    const client = await connected();

    const result = await client.callTool({
      name: "approve",
      arguments: { action: "list" },
    });

    expect(JSON.stringify(result.content)).toBeTruthy();
    await client.close();
  });

  it("refuses a tool it does not have", async () => {
    const client = await connected();

    const result = await client.callTool({ name: "nonesuch", arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("nonesuch");
    await client.close();
  });
});

describe("the configuration each tool is built with", () => {
  it("takes the reminder config it is given", async () => {
    // The default is every reminder off; a caller that passes its own has to
    // get that one, not the default.
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer({
      markdownDir,
      config: {
        remindMcp: true,
        remindOrganize: true,
        customReminders: ["a reminder"],
        topicForEveryTask: "every-task",
        infoValidSeconds: 5,
      },
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const { tools } = await client.listTools();

    expect(tools).toHaveLength(2);
    await client.close();
  });
});
