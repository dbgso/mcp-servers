/**
 * The firewall proxying a real target, in this process.
 *
 * The integration suite spawns the built firewall as a child, so v8 sees none
 * of `server.ts` -- the file that decides whether a tool call is allowed,
 * denied, or held for approval, which is the entire product. These tests run
 * that decision here and put only the target on the other end of a pipe.
 *
 * What each case is about: an allowed call has to reach the target and come
 * back; a denied one must not reach it at all; an `ask` must hold the call and
 * say how to release it; and `--dry-run` has to let everything through while
 * still saying what it would have done, because a dry run that blocks is not a
 * dry run.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import type { CreateServerResult } from "../server.js";
import type { Rule } from "../types.js";

const TARGET = join(import.meta.dirname, "fixtures", "target-server.mjs");

let dir: string;
let running: CreateServerResult | null = null;
let client: Client | null = null;

/** Start the firewall over the fixture target, with the given rules. */
async function start(params: {
  rules: Rule[];
  defaultAction?: "allow" | "deny" | "ask";
  dryRun?: boolean;
  auditLog?: string;
}): Promise<Client> {
  const rulesFile = join(dir, "rules.json");
  await writeFile(
    rulesFile,
    JSON.stringify({ rules: params.rules, defaultAction: params.defaultAction ?? "deny" }),
    "utf-8"
  );

  running = await createServer({
    target: { command: process.execPath, args: [TARGET] },
    rulesFile,
    ...(params.dryRun !== undefined && { dryRun: params.dryRun }),
    ...(params.auditLog !== undefined && { auditLog: params.auditLog }),
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    running.server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

const rule = (over: Partial<Rule>): Rule => ({
  id: "r",
  priority: 100,
  action: "allow",
  toolPattern: "*",
  ...over,
});

const text = (result: { content?: unknown }) => JSON.stringify(result.content ?? []);

async function execute(params: { toolName: string; args?: Record<string, unknown> }) {
  if (!client) throw new Error("not started");
  return client.callTool({
    name: "proxy_execute",
    arguments: { toolName: params.toolName, args: params.args ?? {} },
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "firewall-proxy-"));
});

afterEach(async () => {
  await client?.close();
  await running?.proxyClient.disconnect();
  client = null;
  running = null;
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("the tools the firewall advertises", () => {
  it("are its own, not the target's", async () => {
    // The point of the proxy is that the agent cannot call the target
    // directly, so the target's tools must not appear as callable names.
    await start({ rules: [rule({})] });

    const { tools } = await client!.listTools();

    expect(tools.map((t) => t.name)).toContain("proxy_execute");
    expect(tools.map((t) => t.name)).not.toContain("dangerous_write");
  });

  it("list the target's tools in the description, so the agent can find them", async () => {
    await start({ rules: [rule({})] });

    const { tools } = await client!.listTools();
    const proxy = tools.find((t) => t.name === "proxy_execute");

    expect(proxy?.description).toContain("safe_read");
    expect(proxy?.description).toContain("dangerous_write");
    // A target tool with no description of its own still gets a line.
    expect(proxy?.description).toContain("undocumented: (no description)");
  });
});

describe("an allowed call", () => {
  it("reaches the target and brings the answer back", async () => {
    await start({ rules: [rule({ action: "allow", toolPattern: "safe_*" })] });

    const result = await execute({ toolName: "safe_read", args: { path: "/etc/hosts" } });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("safe_read called");
    expect(text(result)).toContain("/etc/hosts");
  });

  it("keeps the target's own error flag on a result it returned", async () => {
    // A tool that answers `isError: true` is reporting a failure, not
    // refusing to run. Dropping the flag would read as success.
    await start({ rules: [rule({ action: "allow" })] });

    const result = await execute({ toolName: "answers_with_error" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("the tool failed");
  });

  it("forwards the target's own failure rather than hiding it", async () => {
    await start({ rules: [rule({ action: "allow" })] });

    const result = await execute({ toolName: "always_throws" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("the target refused");
  });
});

describe("a denied call", () => {
  it("is refused with the rule's reason, and never reaches the target", async () => {
    await start({
      rules: [rule({ id: "no-writes", action: "deny", toolPattern: "dangerous_*" })],
    });

    const result = await execute({ toolName: "dangerous_write", args: { path: "/etc/passwd" } });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("BLOCKED");
    expect(text(result)).not.toContain("dangerous_write called");
  });

  it("is refused by the default action when no rule matches", async () => {
    // Deny-by-default is the whole posture: a tool nobody wrote a rule for is
    // not a tool the agent may call.
    await start({ rules: [rule({ toolPattern: "safe_*" })], defaultAction: "deny" });

    const result = await execute({ toolName: "dangerous_write" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("BLOCKED");
  });
});

describe("a call that needs approval", () => {
  it("is held, and says which request to approve", async () => {
    await start({
      rules: [rule({ id: "ask-writes", action: "ask", toolPattern: "dangerous_*" })],
    });

    const result = await execute({ toolName: "dangerous_write", args: { path: "/tmp/x" } });

    expect(text(result)).toContain("APPROVAL REQUIRED");
    expect(text(result)).toContain("proxy_approve");
    // Held, not executed.
    expect(text(result)).not.toContain("dangerous_write called");
  });
});

describe("ask as the default action", () => {
  it("holds the call, rather than failing because no rule matched", async () => {
    // `defaultAction: "ask"` is a sensible posture -- allow what is written
    // down, ask about everything else -- and a rules file may well say it.
    // Nothing matched, so there is no rule to attribute the hold to, and the
    // hold has to happen anyway.
    await start({ rules: [rule({ toolPattern: "safe_*" })], defaultAction: "ask" });

    const result = await execute({ toolName: "dangerous_write", args: { path: "/tmp/x" } });

    expect(text(result)).toContain("APPROVAL REQUIRED");
    expect(text(result)).not.toContain("dangerous_write called");
    expect(text(result)).not.toContain("invariant");
  });
});

describe("a tool the target does not have", () => {
  it("is reported before any rule is consulted", async () => {
    await start({ rules: [rule({ action: "allow" })] });

    const result = await execute({ toolName: "nonesuch" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Unknown tool");
    expect(text(result)).toContain("safe_read");
  });
});

describe("dry run", () => {
  it("lets a denied call through, and says it would have been blocked", async () => {
    // The point of a dry run is to find out what a rule set would do without
    // breaking the session it is being tried on.
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    await start({
      rules: [rule({ id: "no-writes", action: "deny", toolPattern: "dangerous_*" })],
      dryRun: true,
    });

    const result = await execute({ toolName: "dangerous_write", args: { path: "/tmp/x" } });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("DRY-RUN NOTE");
    expect(text(result)).toContain("dangerous_write called");
    expect(stderr.mock.calls.flat().join(" ")).toContain("DRY-RUN");
  });

  it("lets a call that would need approval through, and says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await start({
      rules: [rule({ id: "ask-writes", action: "ask", toolPattern: "dangerous_*" })],
      dryRun: true,
    });

    const result = await execute({ toolName: "dangerous_write" });

    expect(text(result)).toContain("would require approval");
    expect(text(result)).toContain("dangerous_write called");
  });
});

describe("the audit log", () => {
  it("records what was allowed, denied and held", async () => {
    const auditLog = join(dir, "audit.jsonl");
    await start({
      rules: [
        rule({ id: "allow-reads", priority: 300, action: "allow", toolPattern: "safe_*" }),
        rule({ id: "ask-writes", priority: 200, action: "ask", toolPattern: "dangerous_*" }),
        rule({ id: "deny-rest", priority: 100, action: "deny", toolPattern: "always_*" }),
      ],
      auditLog,
    });

    await execute({ toolName: "safe_read" });
    await execute({ toolName: "dangerous_write" });
    await execute({ toolName: "always_throws" });

    const lines = (await readFile(auditLog, "utf-8")).trim().split("\n");
    const decisions = lines.map((l) => JSON.parse(l) as { action: string; toolName: string });
    expect(decisions.map((d) => d.action)).toEqual(["allow", "ask", "deny"]);
    expect(decisions.map((d) => d.toolName)).toEqual([
      "safe_read",
      "dangerous_write",
      "always_throws",
    ]);
  });
});
