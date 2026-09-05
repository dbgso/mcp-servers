import { describe, expect, it } from "vitest";
import { fileSource } from "../sources/file.js";
import { githubChecksSource, parseCheckRuns } from "../sources/github-checks.js";
import { githubIssueSource, parseComments, parseIssue } from "../sources/github-issue.js";
import { repoSlug } from "../sources/gh.js";
import { httpSource } from "../sources/http.js";
import { allSources, getSource, getSourcesByCategory } from "../sources/registry.js";
import { buildSlackUrl, parseSlackPayload, slackSource } from "../sources/slack.js";
import { createFakeDeps, scriptedCommands, sequence } from "./helpers.js";

const CHECK_RUNS_RUNNING = JSON.stringify({
  check_runs: [
    { name: "build", status: "in_progress", conclusion: null },
    { name: "test", status: "completed", conclusion: "success" },
  ],
});

const CHECK_RUNS_DONE = JSON.stringify({
  check_runs: [
    { name: "build", status: "completed", conclusion: "failure" },
    { name: "test", status: "completed", conclusion: "success" },
  ],
});

describe("gh helpers", () => {
  it.each([
    { repo: undefined, expected: "{owner}/{repo}" },
    { repo: "dbgso/mcp-servers", expected: "dbgso/mcp-servers" },
  ])("builds the repo slug for $repo", ({ repo, expected }) => {
    expect(repoSlug(repo)).toBe(expected);
  });
});

describe("github_checks source", () => {
  it("resolves the current branch and reports progress", async () => {
    const seen: string[] = [];
    const deps = createFakeDeps({
      runCommand: (spec) => {
        seen.push([spec.command, ...spec.args].join(" "));
        if (spec.command === "git") {
          return { stdout: "feat/x\n", stderr: "", exitCode: 0 };
        }
        return { stdout: CHECK_RUNS_RUNNING, stderr: "", exitCode: 0 };
      },
    });

    const outcome = await githubChecksSource.poll({ config: {}, state: undefined, deps });

    expect(outcome.satisfied).toBe(false);
    expect(outcome.summary).toBe("1/2 checks completed");
    expect(seen[0]).toContain("git rev-parse");
    expect(seen[1]).toContain("commits/feat/x/check-runs");
  });

  it("reuses the resolved ref and reports the failure once", async () => {
    const deps = createFakeDeps({
      runCommand: scriptedCommands([{ match: /check-runs/, stdout: CHECK_RUNS_DONE }]),
    });

    const outcome = await githubChecksSource.poll({
      config: { ref: "main" },
      state: { ref: "main", failed: [] },
      deps,
    });

    expect(outcome.satisfied).toBe(true);
    expect(outcome.events).toEqual(["build failed"]);
    expect(outcome.state).toEqual({ ref: "main", failed: ["build"] });

    const repeated = await githubChecksSource.poll({
      config: { ref: "main" },
      state: outcome.state,
      deps,
    });
    expect(repeated.events).toEqual([]);
  });

  it("resolves a PR to its head sha", async () => {
    const deps = createFakeDeps({
      runCommand: scriptedCommands([
        { match: /pulls\/42/, stdout: "abc123\n" },
        { match: /check-runs/, stdout: CHECK_RUNS_DONE },
      ]),
    });

    const outcome = await githubChecksSource.poll({ config: { pr: 42 }, state: undefined, deps });

    expect((outcome.state as { ref: string }).ref).toBe("abc123");
    expect((outcome.details as { outcome: string }).outcome).toBe("failure");
  });

  it("fails when gh exits non-zero", async () => {
    const deps = createFakeDeps({
      runCommand: () => ({ stdout: "", stderr: "gh: not authenticated", exitCode: 1 }),
    });

    await expect(
      githubChecksSource.poll({ config: { ref: "main" }, state: undefined, deps }),
    ).rejects.toThrow("not authenticated");
  });

  it("fails when the current branch cannot be resolved", async () => {
    const deps = createFakeDeps({
      runCommand: () => ({ stdout: "", stderr: "not a git repository", exitCode: 128 }),
    });

    await expect(githubChecksSource.poll({ config: {}, state: undefined, deps })).rejects.toThrow(
      "could not resolve current branch",
    );
  });

  it("fails when gh returns non-JSON output", async () => {
    const deps = createFakeDeps({
      runCommand: scriptedCommands([{ match: /check-runs/, stdout: "not json" }]),
    });

    await expect(
      githubChecksSource.poll({ config: { ref: "main" }, state: undefined, deps }),
    ).rejects.toThrow("non-JSON");
  });

  it.each([
    { title: "missing payload", payload: null, expected: 0 },
    { title: "empty list", payload: { check_runs: [] }, expected: 0 },
    { title: "sparse entries", payload: { check_runs: [{}] }, expected: 1 },
  ])("parses check runs from $title", ({ payload, expected }) => {
    expect(parseCheckRuns(payload)).toHaveLength(expected);
  });
});

describe("github_issue source", () => {
  const issuePayload = JSON.stringify({ state: "open", title: "Title", labels: [{ name: "bug" }] });
  const commentsPayload = JSON.stringify([{ id: 7, user: { login: "alice" }, body: "hi" }]);

  function issueDeps(issue = issuePayload, comments = commentsPayload) {
    return createFakeDeps({
      runCommand: scriptedCommands([
        { match: /comments/, stdout: comments },
        { match: /issues\/\d+$/, stdout: issue },
      ]),
    });
  }

  it("records the baseline on the first poll", async () => {
    const outcome = await githubIssueSource.poll({
      config: { number: 34 },
      state: undefined,
      deps: issueDeps(),
    });

    expect(outcome.satisfied).toBe(false);
    expect(outcome.state).toEqual({ baseline: { state: "open", labels: ["bug"], lastCommentId: 7 } });
    expect(outcome.summary).toContain("#34");
  });

  it("detects a comment posted after the baseline", async () => {
    const outcome = await githubIssueSource.poll({
      config: { number: 34, until: "new_comment" },
      state: { baseline: { state: "open", labels: ["bug"], lastCommentId: 6 } },
      deps: issueDeps(),
    });

    expect(outcome.satisfied).toBe(true);
    expect(outcome.events?.[0]).toContain("alice");
  });

  it("is satisfied immediately when the issue is already closed", async () => {
    const closed = JSON.stringify({ state: "closed", title: "Title", labels: [] });
    const outcome = await githubIssueSource.poll({
      config: { number: 34, until: "closed" },
      state: undefined,
      deps: issueDeps(closed),
    });

    expect(outcome.satisfied).toBe(true);
  });

  it("rejects until=label without a label", async () => {
    await expect(
      githubIssueSource.poll({
        config: { number: 34, until: "label" },
        state: undefined,
        deps: issueDeps(),
      }),
    ).rejects.toThrow("config.label is required");
  });

  it.each([
    { title: "sparse issue", payload: {}, state: "open", labels: 0 },
    { title: "plain string labels", payload: { state: "open", labels: ["bug"] }, state: "open", labels: 1 },
  ])("parses $title", ({ payload, state, labels }) => {
    const parsed = parseIssue(payload);
    expect(parsed.state).toBe(state);
    expect(parsed.labels).toHaveLength(labels);
  });

  it("parses a non-array comments payload as empty", () => {
    expect(parseComments(null)).toEqual([]);
    expect(parseComments([{}])).toEqual([{ id: 0, login: "unknown", body: "" }]);
  });
});

describe("slack source", () => {
  const replies = JSON.stringify({
    ok: true,
    messages: [
      { ts: "1712345678.000100", user: "U1", text: "please review" },
      { ts: "1712345679.000200", user: "U2", text: "LGTM" },
    ],
  });

  it.each([
    { title: "thread", config: { channel: "C1", thread_ts: "1.0" }, expected: "conversations.replies" },
    { title: "channel", config: { channel: "C1" }, expected: "conversations.history" },
  ])("targets the $title endpoint", ({ config, expected }) => {
    expect(buildSlackUrl(config)).toContain(expected);
  });

  it("records the newest message as the baseline on the first poll", async () => {
    const deps = createFakeDeps({
      httpRequest: () => ({ status: 200, body: replies }),
      env: { SLACK_BOT_TOKEN: "xoxb-test" },
    });

    const outcome = await slackSource.poll({ config: { channel: "C1" }, state: undefined, deps });

    expect(outcome.satisfied).toBe(false);
    expect(outcome.state).toEqual({ baselineTs: "1712345679.000200" });
  });

  it("fires on a matching reply after the baseline", async () => {
    const deps = createFakeDeps({
      httpRequest: () => ({ status: 200, body: replies }),
      env: { SLACK_BOT_TOKEN: "xoxb-test" },
    });

    const outcome = await slackSource.poll({
      config: { channel: "C1", match: "LGTM" },
      state: { baselineTs: "1712345678.000100" },
      deps,
    });

    expect(outcome.satisfied).toBe(true);
    expect(outcome.events?.[0]).toContain("LGTM");
  });

  it("fails when the token env var is empty", async () => {
    const deps = createFakeDeps({ httpRequest: () => ({ status: 200, body: replies }) });

    await expect(
      slackSource.poll({ config: { channel: "C1", token_env: "CUSTOM_TOKEN" }, state: undefined, deps }),
    ).rejects.toThrow("CUSTOM_TOKEN");
  });

  it.each([
    { title: "api level error", body: JSON.stringify({ ok: false, error: "channel_not_found" }), message: "channel_not_found" },
    { title: "non-JSON body", body: "<html>", message: "non-JSON" },
  ])("fails on $title", ({ body, message }) => {
    expect(() => parseSlackPayload(body)).toThrow(message);
  });

  it("tolerates a payload without messages", () => {
    expect(parseSlackPayload(JSON.stringify({ ok: true }))).toEqual([]);
    expect(parseSlackPayload(JSON.stringify({ ok: true, messages: [{}] }))).toEqual([
      { ts: "0", user: undefined, text: undefined },
    ]);
  });
});

describe("http source", () => {
  it("passes method, headers and body through", async () => {
    const requests: unknown[] = [];
    const deps = createFakeDeps({
      httpRequest: (request) => {
        requests.push(request);
        return { status: 200, body: '{"status":"done"}' };
      },
    });

    const outcome = await httpSource.poll({
      config: {
        url: "https://example.com/jobs/1",
        method: "POST",
        headers: { "X-Test": "1" },
        body: "{}",
        expect: { json_path: "status", json_equals: "done" },
      },
      state: undefined,
      deps,
    });

    expect(outcome.satisfied).toBe(true);
    expect(requests[0]).toMatchObject({ method: "POST", headers: { "X-Test": "1" }, body: "{}" });
  });

  it("explains what is still unmet", async () => {
    const deps = createFakeDeps({ httpRequest: sequence([{ status: 503, body: "down" }]) });

    const outcome = await httpSource.poll({
      config: { url: "https://example.com/healthz", expect: { status: 200 } },
      state: undefined,
      deps,
    });

    expect(outcome.satisfied).toBe(false);
    expect(outcome.summary).toContain("status 503");
  });
});

describe("file source", () => {
  const stat = { mtimeMs: 100, size: 12 };

  it.each([
    { until: "exists" as const, files: { "/tmp/a": { stat } }, satisfied: true },
    { until: "exists" as const, files: {}, satisfied: false },
    { until: "missing" as const, files: {}, satisfied: true },
    { until: "missing" as const, files: { "/tmp/a": { stat } }, satisfied: false },
  ])("$until with the file present=$satisfied", async ({ until, files, satisfied }) => {
    const deps = createFakeDeps({ files });
    const outcome = await fileSource.poll({ config: { path: "/tmp/a", until }, state: undefined, deps });
    expect(outcome.satisfied).toBe(satisfied);
  });

  it("does not fire on the poll that records the baseline", async () => {
    const deps = createFakeDeps({ files: { "/tmp/a": { stat } } });
    const first = await fileSource.poll({
      config: { path: "/tmp/a", until: "changed" },
      state: undefined,
      deps,
    });
    expect(first.satisfied).toBe(false);

    const changed = createFakeDeps({ files: { "/tmp/a": { stat: { mtimeMs: 200, size: 12 } } } });
    const second = await fileSource.poll({
      config: { path: "/tmp/a", until: "changed" },
      state: first.state,
      deps: changed,
    });
    expect(second.satisfied).toBe(true);
  });

  it.each([
    { title: "matching content", content: "BUILD SUCCESS", satisfied: true },
    { title: "other content", content: "BUILD RUNNING", satisfied: false },
  ])("matches $title", async ({ content, satisfied }) => {
    const deps = createFakeDeps({ files: { "/tmp/a": { content, stat } } });
    const outcome = await fileSource.poll({
      config: { path: "/tmp/a", until: "matches", pattern: "BUILD (SUCCESS|FAILED)" },
      state: undefined,
      deps,
    });
    expect(outcome.satisfied).toBe(satisfied);
  });

  it("treats a missing file as unmatched rather than an error", async () => {
    const deps = createFakeDeps({ files: {} });
    const outcome = await fileSource.poll({
      config: { path: "/tmp/a", until: "matches", pattern: "x" },
      state: undefined,
      deps,
    });
    expect(outcome.satisfied).toBe(false);
  });

  it("rejects until=matches without a pattern", async () => {
    const deps = createFakeDeps({ files: {} });
    await expect(
      fileSource.poll({ config: { path: "/tmp/a", until: "matches" }, state: undefined, deps }),
    ).rejects.toThrow("config.pattern is required");
  });
});

describe("source registry", () => {
  it("exposes every source by id and by category", () => {
    expect(allSources.map((source) => source.id)).toEqual([
      "github_checks",
      "github_issue",
      "slack",
      "http",
      "file",
    ]);
    expect(getSource("http")?.id).toBe("http");
    expect(getSource("nope")).toBeUndefined();
    expect(Object.keys(getSourcesByCategory())).toEqual(["CI", "GitHub", "Chat", "Generic"]);
  });
});
