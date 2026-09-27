/**
 * The `instruction` tool advertises no argument information, on purpose.
 *
 * One tool serves sixteen actions and MCP publishes one schema per tool, so every
 * way of folding sixteen contracts into one is wrong about something. This package
 * tried two: merging the fields and keeping the first declaration of each name,
 * which advertised `list`'s meaning of `id` as the meaning for all fifteen actions
 * that take it and rejected `update(id, sizeExemption: null)` at the boundary
 * because `add` declared the field without `null`; and a discriminated union,
 * which the SDK validates correctly and then publishes as an empty object.
 *
 * So the schema says nothing and `describe` says everything. What
 * keeps that honest is `describe-matches-schemas.test.ts`, which holds every
 * documented example to the handler schema it would be validated against. This
 * file holds the other half: that the tool boundary hands the handler what it was
 * given, and takes nothing away on the way.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerInstructionTools } from "../tools/instruction/index.js";
import { MarkdownReader } from "../services/markdown-reader.js";
import type { ReminderConfig } from "../types/index.js";

const config: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

let tempDir: string;
let client: Client;
// The tool definitions as a client is actually sent them, over a real transport
// pair. Reading the server's internals instead would test what this file is
// about -- the published shape -- against the thing it is published from.
let tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[];

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-schema-"));
  const docsDir = path.join(tempDir, "docs");
  await fs.mkdir(docsDir, { recursive: true });

  const server = new McpServer({ name: "t", version: "1" });
  registerInstructionTools({ server, reader: new MarkdownReader(docsDir), config });

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "probe", version: "1" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  tools = (await client.listTools()).tools as typeof tools;
});

afterEach(async () => {
  await client.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("the tools this server registers", () => {
  it("is the pair, and nothing else", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(["describe", "instruction"]);
  });
});

describe("the instruction tool's schema", () => {
  const instruction = () => tools.find((t) => t.name === "instruction")!;

  it("publishes no properties, so nothing in it can be wrong about an action", () => {
    expect(instruction().inputSchema.properties).toEqual({});
  });

  it("publishes additionalProperties: true, not an empty object", () => {
    // The difference is not cosmetic. An empty shape publishes `properties: {}`
    // and the SDK then discards every argument before the handler sees it,
    // silently -- a tool that looks like it takes nothing and behaves like it.
    // `additionalProperties: true` says "arbitrary arguments" and hands them over.
    expect(instruction().inputSchema.additionalProperties).toBe(true);
  });

  it("requires nothing", () => {
    expect(instruction().inputSchema.required).toBeUndefined();
  });

  it("sends the caller to describe for what the arguments are", () => {
    // With nothing in the schema, the description is the only thing pointing at
    // where the arguments are documented.
    expect(instruction().description).toContain("describe()");
  });

  it("hands every argument to the handler, including ones no action declares", async () => {
    // What `passthrough` buys, asserted through the transport: the arguments
    // survive the boundary. `nonsense` reaches the handler and the handler's own
    // schema is what rejects it -- which is the point of validating there.
    const result = await client.callTool({
      name: "instruction",
      arguments: { action: "read", id: "absent", nonsense: 1 },
    });

    const text = (result.content as { text?: string }[]).map((c) => c.text ?? "").join("");
    // The handler ran and answered about the id it was given, rather than the
    // call being refused at the boundary or arriving with no arguments at all.
    expect(text).toContain("absent");
  });

  it("costs almost nothing to publish", async () => {
    // The merged version of this was 4,647 characters, about 1,150 tokens, in
    // every session's tool list. A number here would be arbitrary; an order of
    // magnitude is the claim.
    expect(JSON.stringify(instruction().inputSchema).length).toBeLessThan(200);
  });
});
