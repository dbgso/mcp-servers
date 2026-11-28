/**
 * The server's routing, and the paths each layer takes when something is
 * missing or malformed.
 *
 * `server.ts` was at 0%: every call to this server arrives through its two
 * request handlers, and the suite drives the operations directly. The rest here
 * is the same shape one level down -- a validate over documents whose type or
 * parent no longer matches the configuration, a storage directory that is not
 * there, a markdown file with no frontmatter, and the default configuration a
 * `ChainConfig` with no `storage` block falls back to.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { ChainManager } from "../chain-manager.js";
import { MarkdownStorage, parseMarkdown } from "../storage/markdown-storage.js";
import { getOperation } from "../operations/registry.js";
import type { ChainConfig } from "../types.js";

const TEST_DIR = "/tmp/chain-server-test";

const config: ChainConfig = {
  types: {
    requirement: { requires: null, description: "Root type" },
    spec: { requires: "requirement", description: "Depends on requirement" },
  },
  storage: { basePath: TEST_DIR, extension: ".md" },
};

/** A client joined to a fresh server over a paired in-memory transport. */
async function connected(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(config);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  vi.restoreAllMocks();
});

describe("the advertised tools", () => {
  it("are describe, query and mutate", async () => {
    const client = await connected();

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      "chain_describe",
      "chain_mutate",
      "chain_query",
    ]);
    await client.close();
  });
});

describe("calling a tool", () => {
  it("reaches the handler the name belongs to", async () => {
    const client = await connected();

    const result = await client.callTool({ name: "chain_describe", arguments: {} });

    expect(JSON.stringify(result.content)).toContain("requirement");
    await client.close();
  });

  it("says which name it does not know", async () => {
    const client = await connected();

    const result = await client.callTool({ name: "chain_nonesuch", arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("chain_nonesuch");
    await client.close();
  });

  it("creates a document through the mutate tool", async () => {
    // End to end: the routing, the operation, and the write.
    const client = await connected();

    const result = await client.callTool({
      name: "chain_mutate",
      arguments: {
        operation: "create",
        params: { type: "requirement", title: "A requirement", content: "text" },
      },
    });

    expect(result.isError).toBeFalsy();
    await client.close();
  });
});

describe("a query the schema refuses", () => {
  it("reports which field is wrong rather than throwing", async () => {
    const client = await connected();

    const result = await client.callTool({
      name: "chain_query",
      arguments: { operation: "read", params: {} },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Validation error");
    await client.close();
  });
});

describe("validate", () => {
  it("reports a document whose type is not in the configuration", async () => {
    // A type removed from the config leaves its documents behind. They are
    // not readable as anything, so the report has to name them.
    const manager = new ChainManager(config);
    const orphanDir = path.join(TEST_DIR, "obsolete");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(
      path.join(orphanDir, "01ABC.md"),
      `---\nid: 01ABC\ntype: obsolete\ntitle: Left behind\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\n\nbody\n`,
      "utf-8"
    );

    const result = await manager.validate();

    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.error).join()).toContain("Unknown type");
  });

  it("reports a document whose parent no longer satisfies its type", async () => {
    const manager = new ChainManager(config);
    const specDir = path.join(TEST_DIR, "spec");
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      path.join(specDir, "01SPEC.md"),
      `---\nid: 01SPEC\ntype: spec\ntitle: Orphaned spec\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\n---\n\nbody\n`,
      "utf-8"
    );

    const result = await manager.validate();

    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.error).join()).toContain("requires a parent");
  });

  it("passes a corpus where every document's parent holds", async () => {
    const manager = new ChainManager(config);
    const req = await manager.create({ type: "requirement", title: "R", content: "b" });
    await manager.create({ type: "spec", title: "S", content: "b", requires: req.id });

    expect((await manager.validate()).valid).toBe(true);
  });
});

describe("the parent a type requires", () => {
  it("names every acceptable type when there is more than one", async () => {
    const manager = new ChainManager({
      types: {
        requirement: { requires: null },
        spec: { requires: "requirement" },
        test: { requires: ["spec", "requirement"] },
      },
      storage: { basePath: TEST_DIR, extension: ".md" },
    });

    const result = await manager.validateParent({ type: "test" });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.error).toContain("spec or requirement");
  });
});

describe("tracing a chain", () => {
  it("stops where the parent it names is gone", async () => {
    // A document can outlive its parent -- the file is just deleted. The
    // trace then ends there rather than failing.
    const manager = new ChainManager(config);
    const req = await manager.create({ type: "requirement", title: "R", content: "b" });
    const spec = await manager.create({
      type: "spec",
      title: "S",
      content: "b",
      requires: req.id,
    });
    rmSync(path.join(TEST_DIR, "requirement", `${req.id}.md`));

    const trace = await manager.trace({ id: spec.id, direction: "up" });

    expect(trace.id).toBe(spec.id);
    expect(trace.children).toEqual([]);
  });
});

describe("storage", () => {
  it("creates its base directory when it is not there", () => {
    const fresh = path.join(TEST_DIR, "nested", "deeper");

    new MarkdownStorage({ basePath: fresh, extension: ".md" });

    expect(existsSync(fresh)).toBe(true);
  });

  it("lists nothing when the base directory has gone away", async () => {
    const storage = new MarkdownStorage({ basePath: TEST_DIR, extension: ".md" });
    rmSync(TEST_DIR, { recursive: true });

    expect(await storage.list()).toEqual([]);
  });

  it("refuses a markdown file with no frontmatter", () => {
    // Every document's id and type live in the frontmatter, so a file without
    // it is not a document this server can place in a chain.
    expect(() => parseMarkdown("# Just a heading\n")).toThrow(/frontmatter/);
  });
});

describe("the default configuration", () => {
  it("falls back to ./docs when no storage block is given", () => {
    // A `ChainConfig` is hand-written, and `storage` is optional in the type.
    // The fallback has to be a real directory rather than undefined.
    const cwd = process.cwd();
    const scratch = path.join(TEST_DIR, "cwd");
    mkdirSync(scratch, { recursive: true });
    process.chdir(scratch);
    try {
      new ChainManager({ types: { requirement: { requires: null } } });

      expect(existsSync(path.join(scratch, "docs"))).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("the operation registry", () => {
  it("resolves a query operation and a mutate operation by the same lookup", () => {
    expect(getOperation("read")).toBeDefined();
    expect(getOperation("create")).toBeDefined();
    expect(getOperation("nonesuch")).toBeUndefined();
  });
});
