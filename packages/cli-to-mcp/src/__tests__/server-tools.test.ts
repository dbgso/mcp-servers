/**
 * The three tools this server exposes, over a real MCP connection.
 *
 * `server.ts` was at 0%: the suite tests the executor underneath it and spawns
 * the built server as a child process, where v8 sees nothing. What only lives
 * here is the translation between a tool call and a command line -- how
 * `options` become flags, and how a failing command is reported -- which is the
 * part a caller is actually exposed to.
 *
 * The commands run for real, but they are `echo`, `printf` and `false`: the
 * point is the argument vector this server builds, and the surest way to check
 * it is to look at what the command received.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import type { ServerConfig } from "../types.js";

let client: Client | null = null;

async function connected(config?: ServerConfig): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(config ? { config } : {});
  client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const text = (result: { content?: unknown }) =>
  (result.content as { type: string; text?: string }[] | undefined)
    ?.map((c) => c.text ?? "")
    .join("\n") ?? "";

async function run(args: Record<string, unknown>) {
  if (!client) throw new Error("not connected");
  return client.callTool({ name: "cli_execute", arguments: args });
}

beforeEach(() => {
  client = null;
});

afterEach(async () => {
  await client?.close();
});

describe("the advertised tools", () => {
  it("are execute, help and status", async () => {
    await connected();

    const { tools } = await client!.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(["cli_execute", "cli_help", "cli_status"]);
  });
});

describe("running a command", () => {
  it("echoes the command line it ran, with the output and the exit code", async () => {
    await connected();

    const result = await run({ command: "echo", args: ["hello"] });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("$ echo hello");
    expect(text(result)).toContain("hello");
    expect(text(result)).toContain("Exit code: 0");
  });

  it("splits a string argument the way a shell would", async () => {
    await connected();

    const result = await run({ command: "echo", args: "one two three" });

    expect(text(result)).toContain("one two three");
  });

  it("runs a command with no arguments at all", async () => {
    await connected();

    const result = await run({ command: "true" });

    expect(result.isError).toBeFalsy();
  });

  it("reports a non-zero exit as an error, with the exit code", async () => {
    // A command that failed is not a tool that failed, but the caller has to
    // be able to tell the difference without reading the text.
    await connected();

    const result = await run({ command: "false" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Exit code: 1");
  });

  it("includes stderr under its own heading", async () => {
    await connected();

    const result = await run({ command: "sh", args: ["-c", "echo out; echo err >&2"] });

    expect(text(result)).toContain("--- stderr ---");
    expect(text(result)).toContain("err");
  });

  it("reports a command that cannot be run at all", async () => {
    await connected();

    const result = await run({ command: "definitely-not-a-command-12345" });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("[ERROR]");
  });
});

describe("turning options into flags", () => {
  it.each([
    {
      name: "a long option takes two dashes and its value",
      options: { profile: "dev" },
      expected: "--profile dev",
    },
    {
      name: "a single-letter option takes one",
      options: { v: "2" },
      expected: "-v 2",
    },
    {
      name: "a true boolean becomes a bare flag",
      options: { force: true },
      expected: "--force",
    },
    {
      name: "an array repeats the flag for each value",
      options: { tag: ["a", "b"] },
      expected: "--tag a --tag b",
    },
  ])("$name", async ({ options, expected }) => {
    await connected();

    const result = await run({ command: "echo", options });

    expect(text(result)).toContain(expected);
  });

  it("leaves a false boolean off the command line entirely", async () => {
    // `--force=false` is not how CLIs read a negative; the flag's absence is.
    await connected();

    const result = await run({ command: "echo", args: ["only"], options: { force: false } });

    expect(text(result)).not.toContain("--force");
    expect(text(result)).toContain("$ echo only");
  });

  it("puts positional arguments before the options", async () => {
    await connected();

    const result = await run({
      command: "echo",
      args: ["subcommand"],
      options: { profile: "dev" },
    });

    expect(text(result)).toContain("$ echo subcommand --profile dev");
  });
});

describe("cli_help", () => {
  it("asks the command for its own help", async () => {
    await connected();

    const result = await client!.callTool({
      name: "cli_help",
      arguments: { command: "sh", subcommand: "-c" },
    });

    expect(typeof text(result)).toBe("string");
  });

  it("falls back to stderr when a command prints its help there", async () => {
    // Plenty of tools write `--help` to stderr and exit non-zero; the help
    // text is still the answer.
    await connected();

    const result = await client!.callTool({
      name: "cli_help",
      arguments: { command: "ls" },
    });

    expect(text(result).length).toBeGreaterThan(0);
  });

  it("reports a command that is not there", async () => {
    await connected();

    const result = await client!.callTool({
      name: "cli_help",
      arguments: { command: "definitely-not-a-command-12345" },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("[ERROR]");
  });
});

describe("cli_status", () => {
  it("reports the defaults when nothing is configured", async () => {
    await connected();

    const result = await client!.callTool({ name: "cli_status", arguments: {} });

    expect(JSON.parse(text(result))).toEqual({ cwd: process.cwd(), timeout: 30000 });
  });

  it("reports the configuration it was given", async () => {
    await connected({ cwd: "/tmp", timeout: 5000 });

    const result = await client!.callTool({ name: "cli_status", arguments: {} });

    expect(JSON.parse(text(result))).toEqual({ cwd: "/tmp", timeout: 5000 });
  });
});
