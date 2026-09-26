import { describe, test, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ProxyClient } from "../proxy-client.js";
import type { TargetConfig } from "../types.js";

// Capture the options ProxyClient hands to the transport without spawning a
// real child process. This lets us assert the merged env (the fix under test)
// directly.
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  // Regular function (not an arrow) so it is constructable via `new`.
  StdioClientTransport: vi.fn(function () {
    return { close: vi.fn(), pid: 1234 };
  }),
}));

const transportMock = vi.mocked(StdioClientTransport);

function envPassedTo(config: TargetConfig): Record<string, string> {
  transportMock.mockClear();
  new ProxyClient(config);
  const opts = transportMock.mock.calls[0]?.[0] as { env?: Record<string, string> };
  return opts.env ?? {};
}

describe("ProxyClient — env inheritance (proxied child must keep PATH/HOME)", () => {
  beforeEach(() => {
    transportMock.mockClear();
  });

  test("inherits process.env so the spawned child can resolve its command", () => {
    const env = envPassedTo({ command: "node", args: [] });
    // Without inheritance the child lost PATH/HOME and command resolution broke.
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
  });

  test("config.env overrides inherited values and adds new keys", () => {
    process.env.MCP_FW_INHERITED = "from-parent";
    try {
      const env = envPassedTo({
        command: "node",
        args: [],
        env: { MCP_FW_INHERITED: "overridden", MCP_FW_EXPLICIT: "yes" },
      });
      expect(env.MCP_FW_INHERITED).toBe("overridden"); // explicit override wins
      expect(env.MCP_FW_EXPLICIT).toBe("yes"); // new key added
      expect(env.PATH).toBe(process.env.PATH); // inherited entries still present
    } finally {
      delete process.env.MCP_FW_INHERITED;
    }
  });

  test("still inherits process.env when config.env is omitted", () => {
    const env = envPassedTo({ command: "node", args: [] });
    expect(env.PATH).toBe(process.env.PATH);
  });

  test("merged env contains only string values (undefined filtered out)", () => {
    const env = envPassedTo({ command: "node", args: [] });
    expect(Object.values(env).every((v) => typeof v === "string")).toBe(true);
  });
});

describe("ProxyClient against a real target", () => {
  // The mock above is module-scoped, so these load the transport for real.
  const TARGET = join(import.meta.dirname, "fixtures", "target-server.mjs");

  async function realClient() {
    vi.doUnmock("@modelcontextprotocol/sdk/client/stdio.js");
    vi.resetModules();
    const { ProxyClient: Real } = await import("../proxy-client.js");
    return new Real({ command: process.execPath, args: [TARGET] });
  }

  test("refuses to list or call anything before it is connected", async () => {
    // A call issued before the handshake would otherwise hang or throw from
    // inside the SDK, where the message says nothing about the proxy.
    const client = await realClient();

    expect(client.isConnected()).toBe(false);
    await expect(client.listTools()).rejects.toThrow(/Not connected/);
    await expect(client.callTool({ name: "safe_read", args: {} })).rejects.toThrow(
      /Not connected/,
    );
  });

  test("connects once, caches the tool list, and disconnects once", async () => {
    const client = await realClient();

    await client.connect();
    await client.connect(); // second call is a no-op
    expect(client.isConnected()).toBe(true);
    expect(client.getCachedTools()).toBeNull();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("safe_read");
    expect(client.getCachedTools()).toHaveLength(tools.length);
    expect(typeof client.getPid()).toBe("number");
    expect(client.getConfig().command).toBe(process.execPath);

    const result = await client.callTool({ name: "safe_read", args: { path: "/x" } });
    expect(JSON.stringify(result.content)).toContain("safe_read called");

    await client.disconnect();
    await client.disconnect(); // second call is a no-op
    expect(client.isConnected()).toBe(false);
    expect(client.getCachedTools()).toBeNull();
  });
});
