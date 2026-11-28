import { describe, it, expect } from "vitest";
import { expandVars, resolveLaunch } from "../launch.js";

const TSX = "/wt/node_modules/.bin/tsx";

describe("expandVars", () => {
  const vars = { SCRATCH: "/tmp/s1", WORKTREE: "/wt" };

  it.each([
    { name: "a bare token", value: "{{SCRATCH}}", expected: "/tmp/s1" },
    { name: "a token in a path", value: "{{SCRATCH}}/docs", expected: "/tmp/s1/docs" },
    { name: "two different tokens", value: "{{WORKTREE}}:{{SCRATCH}}", expected: "/wt:/tmp/s1" },
    { name: "the same token twice", value: "{{SCRATCH}}{{SCRATCH}}", expected: "/tmp/s1/tmp/s1" },
  ])("expands $name", ({ value, expected }) => {
    expect(expandVars({ value, vars })).toBe(expected);
  });

  it("leaves an unknown name alone rather than writing `undefined`", () => {
    // `/undefined/docs` is a directory a server will happily create and then
    // report success from.
    expect(expandVars({ value: "{{NOPE}}/docs", vars })).toBe("{{NOPE}}/docs");
  });

  it("reaches into arrays and nested objects", () => {
    const value = { args: ["{{SCRATCH}}"], env: { DIR: "{{SCRATCH}}/x" }, n: 1, flag: true };

    expect(expandVars({ value, vars })).toEqual({
      args: ["/tmp/s1"],
      env: { DIR: "/tmp/s1/x" },
      n: 1,
      flag: true,
    });
  });
});

describe("resolveLaunch", () => {
  it("runs a package from source through tsx", () => {
    const result = resolveLaunch({ worktree: "/wt", package: "kroki-mcp", tsx: TSX });

    expect(result).toEqual({
      ok: true,
      spec: { command: TSX, args: ["/wt/packages/kroki-mcp/src/index.ts"], cwd: "/wt" },
    });
  });

  it("puts the server's own arguments after the entry point", () => {
    const result = resolveLaunch({
      worktree: "/wt",
      package: "interactive-instruction-mcp",
      args: ["./docs", "--exclude", "chain"],
      tsx: TSX,
    });

    expect(result.ok && result.spec.args).toEqual([
      "/wt/packages/interactive-instruction-mcp/src/index.ts",
      "./docs",
      "--exclude",
      "chain",
    ]);
  });

  it("runs an explicit command from the worktree", () => {
    const result = resolveLaunch({ worktree: "/wt", command: "npx", args: ["@playwright/mcp"], tsx: TSX });

    expect(result).toEqual({ ok: true, spec: { command: "npx", args: ["@playwright/mcp"], cwd: "/wt" } });
  });

  it.each([
    { name: "neither package nor command", request: {}, message: "Pass `package`" },
    {
      name: "both package and command",
      request: { package: "kroki-mcp", command: "npx" },
      message: "not both",
    },
  ])("rejects $name", ({ request, message }) => {
    const result = resolveLaunch({ worktree: "/wt", tsx: TSX, ...request });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain(message);
  });
});
