/**
 * The tools, driven the way a client drives them: over a transport, with
 * arguments as a client sends them when the schema names none.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { HANDLERS } from "../tools/index.js";
import { scratchChain, seedChain } from "./helpers.js";
import type { ClaimChain } from "../chain.js";

let client: Client;
let chain: ClaimChain;
let cleanup: () => Promise<void>;

async function call(args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name: "execute", arguments: args });
  const content = result.content as { type: string; text?: string }[];
  return { text: content.map((part) => part.text ?? "").join("\n"), isError: result.isError === true };
}

beforeEach(async () => {
  let root: string;
  ({ chain, root, cleanup } = await scratchChain());
  const server = createServer({ root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  await cleanup();
});

describe("tool surface", () => {
  it("publishes describe and execute, and no argument information", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["describe", "execute"]);
    const execute = tools.find((tool) => tool.name === "execute");
    expect(execute?.inputSchema.properties ?? {}).toEqual({});
  });

  it("describes every action and the kinds", async () => {
    const result = await client.callTool({ name: "describe", arguments: {} });
    const text = (result.content as { text: string }[])[0].text;
    for (const handler of HANDLERS) expect(text).toContain(`### ${handler.action}`);
    expect(text).toContain("| P | A principle");
  });

  it("names the actions when the action is missing or unknown", async () => {
    expect(await call({})).toMatchObject({ isError: true, text: expect.stringContaining("Actions: add, update") });
    expect(await call({ action: "nope" })).toMatchObject({ isError: true, text: expect.stringContaining('"nope"') });
  });

  it("shows the action's help when its arguments are wrong", async () => {
    expect(await call({ action: "read" })).toMatchObject({ isError: true, text: expect.stringContaining("One claim or gap") });
  });
});

describe("actions", () => {
  it("adds a claim from arguments sent as strings", async () => {
    await call({ action: "add", kind: "DEF", fields: '{"term":"t","meaning":"m"}' });
    const result = await call({ action: "add", kind: "P", fields: '{"modality":"must","statement":"s"}', refs: '["DEF-0001"]' });
    expect(result).toMatchObject({ isError: false, text: expect.stringContaining("Added **P-0001**") });
    expect(result.text).toContain("- **refs**: DEF-0001@");
  });

  it("takes a fields string that is not JSON as an error, not a crash", async () => {
    expect(await call({ action: "add", kind: "DEF", fields: "{not json" })).toMatchObject({ isError: true });
  });

  it("walks the loop: rejected, recorded, unblocked, resolved", async () => {
    await seedChain(chain);

    const noWant = await call({ action: "add", kind: "S", fields: { behavior: "b" } });
    expect(noWant).toMatchObject({ isError: true, text: expect.stringContaining("with `want`") });

    const gap = await call({ action: "add", kind: "S", fields: { behavior: "b" }, want: "what inside an expression may reveal" });
    expect(gap).toMatchObject({ isError: true, text: expect.stringContaining("GAP-0001 — needs a C (open)") });
    expect((await call({ action: "gaps" })).text).toContain("what inside an expression may reveal");

    const criterion = await call({ action: "add", kind: "C", fields: { condition: "c2" }, refs: ["P-0001"] });
    expect(criterion.text).toContain("# Now writable");
    expect(criterion.text).toContain('refs: ["C-0002"], resolves: "GAP-0001"');
    expect((await call({ action: "unblocked", id: "C-0002" })).text).toContain("GAP-0001");

    const written = await call({ action: "add", kind: "S", fields: { behavior: "b" }, refs: ["C-0002"], resolves: "GAP-0001" });
    expect(written.text).toContain("Resolved GAP-0001.");
    expect((await call({ action: "gaps" })).text).toBe("No open gaps.");
    expect((await call({ action: "unblocked", id: "C-0002" })).text).toBe("No open gap is waiting for C-0002.");
    expect((await call({ action: "read", id: "GAP-0001" })).text).toContain("**resolved by**: S-0002");
  });

  it("rejects a citation of the wrong kind with what it may cite", async () => {
    await seedChain(chain);
    const result = await call({ action: "add", kind: "S", fields: { behavior: "b" }, refs: ["P-0001"] });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("S cannot cite a P (P-0001); it cites C") });
    expect(result.text).not.toContain("with `want`");
  });

  it("updates, lists what went stale, and check fails until it is confirmed", async () => {
    await seedChain(chain);
    const updated = await call({ action: "update", id: "C-0001", fields: { condition: "changed" } });
    expect(updated.text).toContain("# Now stale");
    expect(await call({ action: "check" })).toMatchObject({ isError: true, text: expect.stringContaining("[stale-ref]") });
    expect((await call({ action: "read", id: "S-0001" })).text).toContain("**Stale**: cites an old version of C-0001");

    await call({ action: "update", id: "S-0001", refs: '["C-0001"]' });
    expect(await call({ action: "check" })).toEqual({ isError: false, text: "No findings." });
  });

  it("refuses an update that breaks the shape", async () => {
    await seedChain(chain);
    expect(await call({ action: "update", id: "S-0001", refs: [] })).toMatchObject({
      isError: true,
      text: expect.stringContaining("Not updated."),
    });
  });

  it("lists, reads and traces", async () => {
    expect((await call({ action: "list" })).text).toBe("No claims.");
    await seedChain(chain);
    expect((await call({ action: "list", kind: "P" })).text).toBe("- **P-0001** — must_not");
    expect((await call({ action: "read", id: "P-0001" })).text).toContain("# Cited by\n\n- **C-0001**");
    expect((await call({ action: "trace", id: "S-0001" })).text).toBe("- S-0001\n  - C-0001\n    - P-0001\n      - DEF-0001");
    expect((await call({ action: "trace", id: "P-0001", direction: "down" })).text).toBe("- P-0001\n  - C-0001\n    - S-0001");
  });

  it("reports a failure inside an action as an error", async () => {
    expect(await call({ action: "read", id: "X-0001" })).toMatchObject({ isError: true, text: expect.stringContaining("X-0001 does not exist") });
  });
});
