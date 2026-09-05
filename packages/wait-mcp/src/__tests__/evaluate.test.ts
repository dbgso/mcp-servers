import { describe, expect, it } from "vitest";
import { evaluateCheckRuns, type CheckRun } from "../sources/evaluate/check-runs.js";
import { evaluateExpectation } from "../sources/evaluate/http-expect.js";
import {
  buildIssueBaseline,
  evaluateIssue,
  latestCommentId,
  selectNewComments,
  type IssueBaseline,
  type IssueComment,
  type IssueSnapshot,
} from "../sources/evaluate/issue.js";
import { jsonEqual, parseJsonPath, resolveJsonPath, tryParseJson } from "../sources/evaluate/json-path.js";
import { describeMessage, latestTs, selectNewMessages } from "../sources/evaluate/slack.js";
import {
  MAX_BACKOFF_MS,
  nextIntervalMs,
  nextSleepMs,
  remainingMs,
  resolveIntervalMs,
} from "../watch/schedule.js";
import { loadServerConfig, readPositiveInt } from "../config.js";

function run(name: string, status: string, conclusion: string | null = null): CheckRun {
  return { name, status, conclusion };
}

describe("evaluateCheckRuns", () => {
  it.each([
    {
      title: "no checks registered yet",
      runs: [] as CheckRun[],
      requirement: "complete" as const,
      outcome: "pending",
      satisfied: false,
    },
    {
      title: "some checks still running",
      runs: [run("a", "completed", "success"), run("b", "in_progress")],
      requirement: "complete" as const,
      outcome: "pending",
      satisfied: false,
    },
    {
      title: "all checks green",
      runs: [run("a", "completed", "success"), run("b", "completed", "skipped")],
      requirement: "complete" as const,
      outcome: "success",
      satisfied: true,
    },
    {
      title: "all checks done with a failure",
      runs: [run("a", "completed", "success"), run("b", "completed", "failure")],
      requirement: "complete" as const,
      outcome: "failure",
      satisfied: true,
    },
    {
      title: "failure while others run, waiting for completion",
      runs: [run("a", "completed", "failure"), run("b", "in_progress")],
      requirement: "complete" as const,
      outcome: "pending",
      satisfied: false,
    },
    {
      title: "failure while others run, success required",
      runs: [run("a", "completed", "timed_out"), run("b", "queued")],
      requirement: "success" as const,
      outcome: "failure",
      satisfied: true,
    },
  ])("$title", ({ runs, requirement, outcome, satisfied }) => {
    const evaluation = evaluateCheckRuns({ runs, requirement });
    expect(evaluation.outcome).toBe(outcome);
    expect(evaluation.satisfied).toBe(satisfied);
  });

  it("summarizes progress and names the failures", () => {
    const evaluation = evaluateCheckRuns({
      runs: [run("build", "completed", "failure"), run("test", "completed", "success")],
      requirement: "complete",
    });
    expect(evaluation.summary).toBe("2/2 checks completed (failure: build)");
    expect(evaluation.failed).toEqual(["build"]);
    expect(evaluation.completed).toBe(2);
    expect(evaluation.total).toBe(2);
  });

  it("summarizes a clean run without a failure list", () => {
    const evaluation = evaluateCheckRuns({ runs: [run("build", "in_progress")], requirement: "complete" });
    expect(evaluation.summary).toBe("0/1 checks completed");
  });
});

describe("json path", () => {
  it.each([
    { path: "a.b", expected: 1 },
    { path: "list[1]", expected: "second" },
    { path: "list[1].missing", expected: undefined },
    { path: "a.b.c", expected: undefined },
    { path: "missing.deep", expected: undefined },
  ])("resolves $path", ({ path, expected }) => {
    const value = { a: { b: 1 }, list: ["first", "second"] };
    expect(resolveJsonPath({ value, path })).toEqual(expected);
  });

  it("resolves an empty path to the whole document", () => {
    expect(resolveJsonPath({ value: { a: 1 }, path: "" })).toEqual({ a: 1 });
  });

  it("stops at a non-object value", () => {
    expect(resolveJsonPath({ value: { a: 1 }, path: "a.b" })).toBeUndefined();
  });

  it("splits bracket and dot notation", () => {
    expect(parseJsonPath("a.b[0].c")).toEqual(["a", "b", "0", "c"]);
  });

  it("compares values structurally", () => {
    expect(jsonEqual({ a: { a: 1 }, b: { a: 1 } })).toBe(true);
    expect(jsonEqual({ a: undefined, b: null })).toBe(true);
    expect(jsonEqual({ a: { a: 1 }, b: { a: 2 } })).toBe(false);
  });

  it("returns undefined for malformed JSON", () => {
    expect(tryParseJson("{")).toBeUndefined();
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("evaluateExpectation", () => {
  it.each([
    { title: "status match", response: { status: 200, body: "" }, expectation: { status: 200 }, satisfied: true },
    { title: "status list match", response: { status: 204, body: "" }, expectation: { status: [200, 204] }, satisfied: true },
    { title: "status mismatch", response: { status: 500, body: "" }, expectation: { status: 200 }, satisfied: false },
    { title: "body regex match", response: { status: 200, body: "all good" }, expectation: { body_matches: "good" }, satisfied: true },
    { title: "body regex mismatch", response: { status: 200, body: "bad" }, expectation: { body_matches: "good" }, satisfied: false },
    {
      title: "json path equals",
      response: { status: 200, body: '{"status":"done"}' },
      expectation: { json_path: "status", json_equals: "done" },
      satisfied: true,
    },
    {
      title: "json path differs",
      response: { status: 200, body: '{"status":"running"}' },
      expectation: { json_path: "status", json_equals: "done" },
      satisfied: false,
    },
    {
      title: "json regex on whole body",
      response: { status: 200, body: '"done"' },
      expectation: { json_matches: "done" },
      satisfied: true,
    },
    {
      title: "malformed json fails the condition instead of throwing",
      response: { status: 502, body: "<html>bad gateway" },
      expectation: { json_path: "status", json_equals: "done" },
      satisfied: false,
    },
  ])("$title", ({ response, expectation, satisfied }) => {
    expect(evaluateExpectation({ response, expectation }).satisfied).toBe(satisfied);
  });

  it("reports every unmet condition", () => {
    const result = evaluateExpectation({
      response: { status: 500, body: '{"status":"running"}' },
      expectation: { status: 200, body_matches: "ok", json_path: "status", json_equals: "done", json_matches: "done" },
    });
    expect(result.unmet).toHaveLength(4);
  });
});

describe("issue evaluation", () => {
  const issue: IssueSnapshot = { state: "open", title: "T", labels: ["bug"] };
  const comments: IssueComment[] = [
    { id: 1, login: "alice", body: "first" },
    { id: 2, login: "bob", body: "second" },
  ];
  const baseline: IssueBaseline = { state: "open", labels: ["bug"], lastCommentId: 1 };

  it("builds a baseline from the current snapshot", () => {
    expect(buildIssueBaseline({ issue, comments })).toEqual({
      state: "open",
      labels: ["bug"],
      lastCommentId: 2,
    });
    expect(latestCommentId([])).toBe(0);
  });

  it("counts only comments newer than the baseline", () => {
    expect(selectNewComments({ issue, comments, baseline, config: { until: "new_comment" } })).toEqual([
      comments[1],
    ]);
  });

  it("narrows new comments to one author", () => {
    const filtered = selectNewComments({
      issue,
      comments,
      baseline,
      config: { until: "new_comment", from: "alice" },
    });
    expect(filtered).toEqual([]);
  });

  it.each([
    { until: "new_comment" as const, snapshot: issue, expected: true },
    { until: "closed" as const, snapshot: { ...issue, state: "closed" }, expected: true },
    { until: "closed" as const, snapshot: issue, expected: false },
    { until: "state_change" as const, snapshot: { ...issue, state: "closed" }, expected: true },
    { until: "state_change" as const, snapshot: issue, expected: false },
    { until: "label" as const, snapshot: issue, expected: false },
  ])("$until -> $expected", ({ until, snapshot, expected }) => {
    const evaluation = evaluateIssue({
      issue: snapshot,
      comments,
      baseline,
      config: { until, label: "ready" },
    });
    expect(evaluation.satisfied).toBe(expected);
    expect(evaluation.summary).toBeTruthy();
  });

  it("fires once the wanted label is applied", () => {
    const evaluation = evaluateIssue({
      issue: { ...issue, labels: ["bug", "ready"] },
      comments,
      baseline,
      config: { until: "label", label: "ready" },
    });
    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.events).toEqual(["label ready"]);
  });

  it("reports no new comment with the author in the summary", () => {
    const evaluation = evaluateIssue({
      issue,
      comments,
      baseline: { ...baseline, lastCommentId: 2 },
      config: { until: "new_comment", from: "alice" },
    });
    expect(evaluation.satisfied).toBe(false);
    expect(evaluation.summary).toContain("alice");
  });
});

describe("slack evaluation", () => {
  const messages = [
    { ts: "1712345678.000100", user: "U1", text: "parent" },
    { ts: "1712345679.000200", user: "U2", text: "LGTM" },
  ];

  it("orders timestamps numerically", () => {
    expect(latestTs(messages)).toBe("1712345679.000200");
    expect(latestTs([])).toBeUndefined();
    expect(latestTs([{ ts: "not-a-number" }])).toBe("not-a-number");
  });

  it.each([
    { title: "no baseline yet", baselineTs: undefined, filters: {}, count: 0 },
    { title: "newer message", baselineTs: "1712345678.000100", filters: {}, count: 1 },
    { title: "author filter rejects", baselineTs: "1712345678.000100", filters: { from: "U9" }, count: 0 },
    { title: "author filter accepts", baselineTs: "1712345678.000100", filters: { from: "U2" }, count: 1 },
    { title: "text filter rejects", baselineTs: "1712345678.000100", filters: { match: "nope" }, count: 0 },
    { title: "text filter accepts", baselineTs: "1712345678.000100", filters: { match: "LGTM" }, count: 1 },
  ])("$title", ({ baselineTs, filters, count }) => {
    expect(selectNewMessages({ messages, baselineTs, ...filters })).toHaveLength(count);
  });

  it("renders a message for the event log", () => {
    expect(describeMessage({ ts: "1", user: "U2", text: "LGTM" })).toBe("reply from U2: LGTM");
    expect(describeMessage({ ts: "1" })).toBe("reply from unknown: ");
  });
});

describe("schedule", () => {
  const source = { defaultIntervalMs: 20_000, minIntervalMs: 5_000 };

  it.each([
    { requested: undefined, expected: 20_000 },
    { requested: 1_000, expected: 5_000 },
    { requested: 60_000, expected: 60_000 },
  ])("resolves interval $requested -> $expected", ({ requested, expected }) => {
    expect(resolveIntervalMs({ requested, source })).toBe(expected);
  });

  it.each([
    { errors: 0, expected: 10_000 },
    { errors: 1, expected: 20_000 },
    { errors: 3, expected: 80_000 },
    { errors: 10, expected: MAX_BACKOFF_MS },
  ])("backs off after $errors errors", ({ errors, expected }) => {
    expect(nextIntervalMs({ baseMs: 10_000, consecutiveErrors: errors })).toBe(expected);
  });

  it.each([
    { now: 0, expected: 1_000 },
    { now: 600, expected: 400 },
    { now: 5_000, expected: 0 },
  ])("computes remaining time at $now", ({ now, expected }) => {
    expect(remainingMs({ startedAt: 0, timeoutMs: 1_000, now })).toBe(expected);
  });

  it("never sleeps past the deadline", () => {
    expect(nextSleepMs({ baseIntervalMs: 10_000, consecutiveErrors: 0, remainingMs: 3_000 })).toBe(3_000);
    expect(nextSleepMs({ baseIntervalMs: 10_000, consecutiveErrors: 0, remainingMs: 30_000 })).toBe(10_000);
  });
});

describe("server config", () => {
  it.each([
    { raw: undefined, expected: 240_000 },
    { raw: "0", expected: 240_000 },
    { raw: "abc", expected: 240_000 },
    { raw: "60000", expected: 60_000 },
    { raw: "1000.7", expected: 1_000 },
  ])("reads WAIT_MCP_MAX_BLOCK_MS=$raw", ({ raw, expected }) => {
    const env = (name: string) => (name === "WAIT_MCP_MAX_BLOCK_MS" ? raw : undefined);
    expect(readPositiveInt({ env, name: "WAIT_MCP_MAX_BLOCK_MS", fallback: 240_000 })).toBe(expected);
  });

  it("loads both limits", () => {
    const config = loadServerConfig((name) => (name === "WAIT_MCP_MAX_WATCHES" ? "3" : undefined));
    expect(config).toEqual({ maxBlockMs: 240_000, maxWatches: 3 });
  });
});
