import { describe, expect, it } from "vitest";
import { defaultDeps } from "../deps/default.js";
import { evaluateCheckRuns } from "../sources/evaluate/check-runs.js";
import { evaluateExpectation } from "../sources/evaluate/http-expect.js";
import { evaluateIssue } from "../sources/evaluate/issue.js";
import { latestTs, selectNewMessages } from "../sources/evaluate/slack.js";
import { fileSource } from "../sources/file.js";
import { runGh } from "../sources/gh.js";
import { slackSource } from "../sources/slack.js";
import { systemClock } from "../watch/clock.js";
import { WatchManager } from "../watch/manager.js";
import { createFakeDeps } from "./helpers.js";

describe("system clock", () => {
  it("sleeps in real time and reports the wall clock", async () => {
    const before = systemClock.now();
    await systemClock.sleep(1);
    expect(systemClock.now()).toBeGreaterThanOrEqual(before);
  });
});

describe("default deps edge cases", () => {
  it("reports a command that cannot be spawned as a failure", async () => {
    const result = await defaultDeps.runCommand({ command: "wait-mcp-no-such-binary", args: [] });
    expect(result.exitCode).toBe(1);
  });

  it("runs a command in the given directory", async () => {
    const result = await defaultDeps.runCommand({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.cwd())"],
      cwd: "/tmp",
    });
    expect(result.stdout).toContain("/tmp");
  });

  it("defaults to GET without headers or body", async () => {
    const original = globalThis.fetch;
    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response("", { status: 200 });
    }) as typeof fetch;

    await defaultDeps.httpRequest({ url: "https://example.com" });

    globalThis.fetch = original;
    expect(seen?.method).toBe("GET");
  });
});

describe("gh error reporting", () => {
  it("falls back to stdout when stderr is empty", async () => {
    const deps = createFakeDeps({
      runCommand: () => ({ stdout: "rate limit exceeded", stderr: "", exitCode: 1 }),
    });

    await expect(runGh({ deps, args: ["api", "x"], cwd: undefined })).rejects.toThrow("rate limit exceeded");
  });
});

describe("evaluation edge cases", () => {
  it("treats a completed check without a conclusion as not failed", () => {
    const evaluation = evaluateCheckRuns({
      runs: [{ name: "a", status: "completed", conclusion: null }],
      requirement: "success",
    });
    expect(evaluation.outcome).toBe("success");
  });

  it("names the whole document when json conditions have no path", () => {
    const result = evaluateExpectation({
      response: { status: 200, body: '"running"' },
      expectation: { json_equals: "done" },
    });
    expect(result.unmet[0]).toContain("$");
  });

  it("treats a label condition without a label as unmet", () => {
    const evaluation = evaluateIssue({
      issue: { state: "open", title: "T", labels: ["bug"] },
      comments: [],
      baseline: { state: "open", labels: ["bug"], lastCommentId: 0 },
      config: { until: "label" },
    });
    expect(evaluation.satisfied).toBe(false);
  });

  it("orders messages without a timestamp last", () => {
    expect(latestTs([{ ts: "2" }, { ts: undefined as unknown as string }])).toBe("2");
    expect(selectNewMessages({ messages: [{ ts: undefined as unknown as string }], baselineTs: "1" })).toEqual([]);
  });
});

describe("file source edge cases", () => {
  it("defaults to the exists condition", async () => {
    const deps = createFakeDeps({ files: { "/tmp/a": { stat: { mtimeMs: 1, size: 1 } } } });
    const outcome = await fileSource.poll({ config: { path: "/tmp/a" }, state: undefined, deps });
    expect(outcome.satisfied).toBe(true);
  });

  it("counts a deleted file as a change", async () => {
    const deps = createFakeDeps({ files: {} });
    const outcome = await fileSource.poll({
      config: { path: "/tmp/a", until: "changed" },
      state: { baseline: { mtimeMs: 1, size: 1 } },
      deps,
    });
    expect(outcome.satisfied).toBe(true);
  });
});

describe("slack source edge cases", () => {
  it("uses the default token env var", async () => {
    const deps = createFakeDeps({
      httpRequest: () => ({ status: 200, body: JSON.stringify({ ok: true, messages: [] }) }),
      env: { SLACK_BOT_TOKEN: "xoxb" },
    });

    const outcome = await slackSource.poll({ config: { channel: "C1" }, state: undefined, deps });
    expect(outcome.state).toEqual({ baselineTs: "0" });
  });
});

describe("manager edge cases", () => {
  it("keeps a poll without events and without state", async () => {
    const manager = new WatchManager({
      deps: createFakeDeps({ httpRequest: () => ({ status: 200, body: "ok" }) }),
    });

    const result = await manager.until({
      spec: { source: "http", config: { url: "https://example.com", expect: { status: 200 } } },
    });

    expect(result.watches[0].status).toBe("satisfied");
    expect(result.watches[0].events).toEqual(["expectation met (status 200)"]);
  });

  it("surfaces a source that rejects with a non-error value", async () => {
    const manager = new WatchManager({
      maxConsecutiveErrors: 1,
      deps: createFakeDeps({
        httpRequest: () => {
          throw "plain string failure";
        },
      }),
    });

    const result = await manager.until({
      spec: { source: "http", config: { url: "https://example.com", expect: { status: 200 } } },
    });

    expect(result.watches[0].status).toBe("failed");
    expect(result.watches[0].summary).toContain("plain string failure");
  });
});
