import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDeps } from "../deps/default.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/sample.txt", import.meta.url));

describe("defaultDeps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { title: "successful command", script: "console.log('hi')", exitCode: 0, stdout: "hi" },
    { title: "failing command", script: "process.exit(3)", exitCode: 3, stdout: "" },
  ])("runs a $title", async ({ script, exitCode, stdout }) => {
    const result = await defaultDeps.runCommand({ command: process.execPath, args: ["-e", script] });
    expect(result.exitCode).toBe(exitCode);
    expect(result.stdout.trim()).toBe(stdout);
  });

  it("reads a file and its stat", async () => {
    expect(await defaultDeps.readFileText(FIXTURE)).toContain("BUILD SUCCESS");
    const stat = await defaultDeps.statFile(FIXTURE);
    expect(stat?.size).toBeGreaterThan(0);
  });

  it("returns null for a missing file", async () => {
    expect(await defaultDeps.statFile(`${FIXTURE}.missing`)).toBeNull();
  });

  it("reads the process environment", () => {
    process.env.WAIT_MCP_TEST_VALUE = "present";
    expect(defaultDeps.env("WAIT_MCP_TEST_VALUE")).toBe("present");
    delete process.env.WAIT_MCP_TEST_VALUE;
  });

  it("reports the current time", () => {
    expect(defaultDeps.now()).toBeGreaterThan(0);
  });

  it("performs an HTTP request", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: unknown) => {
      calls.push({ url, init });
      return new Response("pong", { status: 201 });
    });

    const response = await defaultDeps.httpRequest({
      url: "https://example.com/ping",
      method: "POST",
      headers: { "X-Test": "1" },
      body: "ping",
    });

    expect(response).toEqual({ status: 201, body: "pong" });
    expect(calls[0]).toMatchObject({ url: "https://example.com/ping" });
  });
});
