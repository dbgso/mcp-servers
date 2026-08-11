import { describe, test, expect, vi, beforeEach } from "vitest";
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
