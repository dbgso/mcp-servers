/**
 * The paths that only show up when something has gone wrong: a server that
 * printed nothing, a child that died mid-session, a worktree with no tsx, a
 * session stopped twice.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createServer, installShutdown } from "../server.js";
import { SessionStore } from "../session-store.js";
import { LabSession, makeScratch, messageOf } from "../session.js";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const worktree = path.resolve(packageRoot, "../..");
const fixture = path.join(packageRoot, "src/__tests__/fixtures/counter-server.ts");
const tsx = path.join(worktree, "node_modules/.bin/tsx");

let client: Client;
let store: SessionStore;

async function call(args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name: "execute", arguments: args });
  return (result.content as { text?: string }[]).map((part) => part.text ?? "").join("\n");
}

async function startFixture(overrides: Record<string, unknown> = {}): Promise<string> {
  const text = await call({ action: "start", worktree, command: tsx, args: [fixture], ...overrides });
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

describe("when the server says nothing", () => {
  it("says so rather than showing an empty code block", async () => {
    const id = await startFixture({ env: { QUIET: "1" } });

    expect(await call({ action: "logs", session: id })).toContain("printed nothing on stderr");
  }, 20_000);
});

describe("when the child is gone", () => {
  it("points at the logs instead of leaking the transport error", async () => {
    const id = await startFixture();
    // Close the client end, which kills the child: the next call has no one
    // to talk to, which is what a crashed server looks like from here.
    await store.get(id)?.stop({ keepScratch: true });

    const text = await call({ action: "call", session: id, tool: "bump" });

    expect(text).toContain("Call failed");
    expect(text).toContain(`action: "logs", session: "${id}"`);
  }, 20_000);
});

describe("when the worktree has no tsx", () => {
  it("says which worktree, and what to do about it", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-lab-empty-"));
    try {
      const text = await call({ action: "start", worktree: empty, package: "anything" });

      expect(text).toContain("tsx not found");
      expect(text).toContain(empty);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

describe("unknown sessions", () => {
  it.each([
    { action: "tools" },
    { action: "logs" },
    { action: "stop" },
  ])("$action names the running sessions", async ({ action }) => {
    const id = await startFixture();

    expect(await call({ action, session: "s99" })).toContain(`Running: ${id}`);
  }, 20_000);
});

describe("a server that cannot be spawned at all", () => {
  it("reports the spawn failure with nothing to quote", async () => {
    // Nothing was ever started, so there is no stderr to attach -- the message
    // has to stand on its own.
    const text = await call({ action: "start", worktree, command: "/nonexistent-binary-for-a-test" });

    expect(text).toContain("Session failed to start");
    expect(text).not.toContain("undefined");
  }, 20_000);
});

describe("a server that will not stop printing", () => {
  it("keeps the last lines rather than growing without bound", async () => {
    const id = await startFixture({ env: { NOISY: "500" } });
    // Give the pipe time to deliver everything the child wrote at startup.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const text = await call({ action: "logs", session: id });
    const lines = text.split("\n").filter((line) => line.startsWith("noise "));

    expect(lines.length).toBeLessThanOrEqual(200);
    expect(text).toContain("noise 500");
    expect(text).not.toContain("noise 1\n");
  }, 20_000);
});

describe("a tool with no description", () => {
  it("renders without printing `undefined`", async () => {
    const id = await startFixture();

    const listed = await call({ action: "tools", session: id });
    const detail = await call({ action: "tools", session: id, tool: "bare" });

    expect(listed).toContain("**bare**");
    expect(listed).not.toContain("undefined");
    expect(detail).not.toContain("undefined");
  }, 20_000);
});

describe("LabSession", () => {
  it("stops only once, however many times it is asked", async () => {
    const scratch = await makeScratch("t1");
    const session = new LabSession({ id: "t1", spec: { command: tsx, args: [fixture], cwd: worktree }, scratch, env: {} });
    await session.start();

    await session.stop({ keepScratch: false });
    // The second call must not throw, and must not try to remove a directory
    // some later session may already own.
    await expect(session.stop({ keepScratch: false })).resolves.toBeUndefined();
  }, 20_000);

  it("reports what it was started with", async () => {
    const scratch = await makeScratch("t2");
    const spec = { command: tsx, args: [fixture], cwd: worktree };
    const session = new LabSession({ id: "t2", spec, scratch, env: { MARKER: "x" } });

    const info = session.info();
    expect(info).toMatchObject({ id: "t2", spec, scratch, env: { MARKER: "x" } });
    expect(Date.parse(info.startedAt)).not.toBeNaN();

    await fs.rm(scratch, { recursive: true, force: true });
  });
});

describe("messageOf", () => {
  it.each([
    { name: "an Error", value: new Error("boom"), expected: "boom" },
    { name: "a string", value: "plain", expected: "plain" },
    { name: "something else", value: { code: 1 }, expected: "[object Object]" },
  ])("reads $name", ({ value, expected }) => {
    expect(messageOf(value)).toBe(expected);
  });
});

describe("installShutdown", () => {
  it("stops every session on SIGINT and SIGTERM", async () => {
    const handlers = new Map<string, () => void>();
    const emptied = new SessionStore();
    let exited = 0;

    installShutdown({
      store: emptied,
      on: ({ signal, handler }) => handlers.set(signal, handler),
      exit: () => {
        exited += 1;
      },
    });

    expect([...handlers.keys()]).toEqual(["SIGINT", "SIGTERM"]);

    handlers.get("SIGINT")?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(exited).toBe(1);
  });
});
