/**
 * The lab, driven the way a client drives it, starting real child servers.
 *
 * In-memory transport for the lab itself, real processes underneath: the point
 * of this server is what happens across a process boundary, so stubbing the
 * child would leave nothing worth testing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createServer } from "../server.js";
import type { SessionStore } from "../session-store.js";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const worktree = path.resolve(packageRoot, "../..");
const fixture = path.join(packageRoot, "src/__tests__/fixtures/counter-server.ts");
const tsx = path.join(worktree, "node_modules/.bin/tsx");

let client: Client;
let store: SessionStore;

/** Start the fixture server, which takes no arguments of its own. */
async function startFixture(overrides: Record<string, unknown> = {}): Promise<string> {
  return call({ action: "start", worktree, command: tsx, args: [fixture], ...overrides });
}

async function call(args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name: "execute", arguments: args });
  const content = result.content as { type: string; text?: string }[];
  return content.map((part) => part.text ?? "").join("\n");
}

function sessionIdIn(text: string): string {
  const match = /Session \*\*(s\d+)\*\* started/.exec(text);
  if (match === null) throw new Error(`No session id in:\n${text}`);
  return match[1];
}

beforeEach(async () => {
  const created = createServer();
  store = created.store;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), created.server.connect(serverTransport)]);
});

afterEach(async () => {
  await store.stopAll();
  await client.close().catch(() => {});
});

describe("start", () => {
  it("reports the session, its scratch directory and the server's tools", async () => {
    const text = await startFixture();

    expect(text).toContain("Session **s1** started.");
    expect(text).toContain("**bump**");
    expect(text).toContain("**echo**");
    expect(text).toMatch(/\*\*scratch\*\*: \/.+mcp-lab-s1-/);
  }, 20_000);

  it("makes a scratch directory that exists while the session does", async () => {
    const text = await startFixture();
    const scratch = /\*\*scratch\*\*: (\S+)/.exec(text)?.[1] ?? "";

    expect((await fs.stat(scratch)).isDirectory()).toBe(true);
  }, 20_000);

  it("expands {{SCRATCH}} in the server's own arguments", async () => {
    const text = await startFixture({ args: [fixture, "{{SCRATCH}}/docs"] });

    expect(text).not.toContain("{{SCRATCH}}");
    expect(text).toMatch(/mcp-lab-s1-\S+\/docs/);
  }, 20_000);

  it.each([
    { name: "a worktree that is not there", args: { worktree: "/no/such/tree" }, message: "No such worktree" },
    { name: "neither package nor command", args: { command: undefined }, message: "Pass `package`" },
  ])("refuses $name", async ({ args, message }) => {
    const text = await call({ action: "start", worktree, command: tsx, args: [fixture], ...args });

    expect(text).toContain(message);
  }, 20_000);

  it("reports what a server that will not start printed on its way out", async () => {
    // "Connection closed" names nothing; the server's own stderr is the answer.
    const text = await call({
      action: "start",
      worktree,
      command: tsx,
      args: [path.join(packageRoot, "src/__tests__/fixtures/does-not-exist.ts")],
    });

    expect(text).toContain("Session failed to start");
  }, 20_000);
});

describe("call", () => {
  it("lands every call in the same process, which is the whole point", async () => {
    // A harness that restarts the server per call would answer count=1 twice.
    const id = sessionIdIn(await startFixture());

    expect(await call({ action: "call", session: id, tool: "bump" })).toContain("count=1");
    expect(await call({ action: "call", session: id, tool: "bump" })).toContain("count=2");
  }, 20_000);

  it("passes arguments through as the server defines them", async () => {
    const id = sessionIdIn(await startFixture());

    const text = await call({ action: "call", session: id, tool: "echo", params: { text: "hello" } });

    expect(JSON.parse(text)).toEqual({ text: "hello" });
  }, 20_000);

  it("expands {{SCRATCH}} in a call's arguments", async () => {
    const started = await startFixture();
    const id = sessionIdIn(started);
    const scratch = /\*\*scratch\*\*: (\S+)/.exec(started)?.[1] ?? "";

    const text = await call({ action: "call", session: id, tool: "echo", params: { dir: "{{SCRATCH}}/x" } });

    expect(JSON.parse(text)).toEqual({ dir: `${scratch}/x` });
  }, 20_000);

  it("returns the server's own error rather than restating it", async () => {
    const id = sessionIdIn(await startFixture());

    expect(await call({ action: "call", session: id, tool: "boom" })).toBe("this tool always fails");
  }, 20_000);

  it("names the running sessions when the id is wrong", async () => {
    const id = sessionIdIn(await startFixture());

    expect(await call({ action: "call", session: "s99", tool: "bump" })).toContain(`Running: ${id}`);
  }, 20_000);

  it("says nothing is running when nothing is", async () => {
    expect(await call({ action: "call", session: "s1", tool: "bump" })).toContain("Nothing is running");
  });
});

describe("tools, logs and list", () => {
  it("lists a session's tools", async () => {
    const id = sessionIdIn(await startFixture());

    expect(await call({ action: "tools", session: id })).toContain("**bump**");
  }, 20_000);

  it("shows one tool's input schema", async () => {
    const id = sessionIdIn(await startFixture());

    const text = await call({ action: "tools", session: id, tool: "echo" });

    expect(text).toContain("## Input schema");
    expect(text).toContain('"text"');
  }, 20_000);

  it("names the tools it does have when asked for one it does not", async () => {
    const id = sessionIdIn(await startFixture());

    expect(await call({ action: "tools", session: id, tool: "nope" })).toContain("Available: bump, echo, bare, boom");
  }, 20_000);

  it("keeps the server's stderr, including the env it was given", async () => {
    const id = sessionIdIn(await startFixture({ env: { MARKER: "from-the-test" } }));

    const text = await call({ action: "logs", session: id });

    expect(text).toContain("counter-server up");
    expect(text).toContain("MARKER=from-the-test");
  }, 20_000);

  it("lists what is running, and says so when nothing is", async () => {
    expect(await call({ action: "list" })).toContain("No sessions running");

    const id = sessionIdIn(await startFixture());
    expect(await call({ action: "list" })).toContain(`## ${id}`);
  }, 20_000);
});

describe("stop", () => {
  it("removes the scratch directory with the session", async () => {
    const started = await startFixture();
    const id = sessionIdIn(started);
    const scratch = /\*\*scratch\*\*: (\S+)/.exec(started)?.[1] ?? "";

    await call({ action: "stop", session: id });

    expect(await fs.access(scratch).then(() => true, () => false)).toBe(false);
    expect(await call({ action: "list" })).toContain("No sessions running");
  }, 20_000);

  it("keeps the scratch directory when asked to", async () => {
    const started = await startFixture();
    const scratch = /\*\*scratch\*\*: (\S+)/.exec(started)?.[1] ?? "";

    await call({ action: "stop", session: sessionIdIn(started), keepScratch: true });

    expect((await fs.stat(scratch)).isDirectory()).toBe(true);
    await fs.rm(scratch, { recursive: true, force: true });
  }, 20_000);

  it("stops everything at once", async () => {
    await startFixture();
    await startFixture();

    expect(await call({ action: "stop", all: true })).toContain("Stopped: s1, s2");
  }, 30_000);

  it("says so when there was nothing to stop", async () => {
    expect(await call({ action: "stop", all: true })).toContain("Nothing was running");
  });

  it("needs to be told what to stop", async () => {
    expect(await call({ action: "stop" })).toContain("Pass `session`");
  });
});

describe("the tool surface", () => {
  it("offers describe and execute", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["describe", "execute"]);
  });

  it("describes every action it registers", async () => {
    const result = await client.callTool({ name: "describe", arguments: {} });
    const text = (result.content as { text?: string }[]).map((c) => c.text ?? "").join("\n");

    for (const action of ["start", "call", "tools", "logs", "list", "stop"]) {
      expect(text).toContain(`### ${action}`);
    }
  });

  it("lists the actions when called without one", async () => {
    expect(await call({})).toContain("Actions: start, call, tools, logs, list, stop");
  });

  it("names the actions it has when given one it does not", async () => {
    expect(await call({ action: "fly" })).toContain('Unknown action: "fly"');
  });
});
