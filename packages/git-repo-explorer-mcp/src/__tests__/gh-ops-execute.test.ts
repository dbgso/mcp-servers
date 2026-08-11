import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

vi.mock("../gh-cache.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gh-cache.js")>();
  return {
    ...actual,
    isGhAvailable: vi.fn(),
    ghCachedExec: vi.fn(),
  };
});

import { isGhAvailable, ghCachedExec } from "../gh-cache.js";
import { repoListOp } from "../operations/gh-repo-list-ops.js";
import { prListOp } from "../operations/gh-pr-list-ops.js";
import { prCommentsOp } from "../operations/gh-pr-comments-ops.js";

const mockIsGhAvailable = vi.mocked(isGhAvailable);
const mockGhCachedExec = vi.mocked(ghCachedExec);

const ctx = { repoPath: "/tmp/x", repoName: "x" };

function parseJson(result: CallToolResult): Record<string, unknown> {
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text) as Record<string, unknown>;
}

beforeEach(() => {
  mockIsGhAvailable.mockReset();
  mockGhCachedExec.mockReset();
});

// ─── gh availability gate (shared across all ops) ─────────────────────────

describe.each([
  { name: "repo_list", run: () => repoListOp.execute({ org: "org" }, ctx) },
  { name: "pr_list", run: () => prListOp.execute({ repo: "o/r" }, ctx) },
  { name: "pr_comments", run: () => prCommentsOp.execute({ repo: "o/r", pr_number: 1 }, ctx) },
])("$name when gh is unavailable", ({ run }) => {
  it("returns an error and does not call ghCachedExec", async () => {
    mockIsGhAvailable.mockResolvedValueOnce(false);
    const result = await run();
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/gh CLI/);
    expect(mockGhCachedExec).not.toHaveBeenCalled();
  });
});

// ─── repoListOp.execute ───────────────────────────────────────────────────

describe("repoListOp.execute", () => {
  const sampleRepos = [
    {
      name: "alpha",
      nameWithOwner: "org/alpha",
      description: null,
      url: "https://example.com/alpha",
      sshUrl: "git@example.com:org/alpha.git",
      isArchived: false,
      isPrivate: false,
      defaultBranchRef: { name: "main" },
      updatedAt: "2026-01-01T00:00:00Z",
      primaryLanguage: { name: "TypeScript" },
    },
    {
      name: "beta",
      nameWithOwner: "org/beta",
      description: "old",
      url: "https://example.com/beta",
      sshUrl: "git@example.com:org/beta.git",
      isArchived: true,
      isPrivate: true,
      defaultBranchRef: null,
      updatedAt: "2026-01-02T00:00:00Z",
      primaryLanguage: null,
    },
    {
      name: "gamma-mcp",
      nameWithOwner: "org/gamma-mcp",
      description: "tool",
      url: "https://example.com/gamma",
      sshUrl: "git@example.com:org/gamma.git",
      isArchived: false,
      isPrivate: false,
      defaultBranchRef: { name: "main" },
      updatedAt: "2026-01-03T00:00:00Z",
      primaryLanguage: { name: "Python" },
    },
  ];

  function callRepoList(args: Parameters<typeof repoListOp.execute>[0]) {
    mockIsGhAvailable.mockResolvedValueOnce(true);
    mockGhCachedExec.mockResolvedValueOnce({ data: sampleRepos, fromCache: false });
    return repoListOp.execute(args, ctx);
  }

  it.each([
    {
      label: "excludes archived by default",
      args: { org: "org" },
      expectedNames: ["alpha", "gamma-mcp"],
    },
    {
      label: "includes archived when include_archived=true",
      args: { org: "org", include_archived: true },
      expectedNames: ["alpha", "beta", "gamma-mcp"],
    },
    {
      label: "filters by query (case-insensitive substring)",
      args: { org: "org", query: "MCP" },
      expectedNames: ["gamma-mcp"],
    },
    {
      label: "filters by language (case-insensitive)",
      args: { org: "org", language: "python" },
      expectedNames: ["gamma-mcp"],
    },
    {
      label: "excludes repos with null primaryLanguage when filtering by language",
      args: { org: "org", include_archived: true, language: "python" },
      expectedNames: ["gamma-mcp"],
    },
    {
      label: "combines query and language",
      args: { org: "org", query: "MCP", language: "python" },
      expectedNames: ["gamma-mcp"],
    },
  ])("$label", async ({ args, expectedNames }) => {
    const json = parseJson(await callRepoList(args));
    expect((json.repos as { name: string }[]).map((r) => r.name)).toEqual(expectedNames);
    expect(json.total).toBe(expectedNames.length);
  });

  it("respects the limit and reports total separately", async () => {
    const json = parseJson(await callRepoList({ org: "org", limit: 1 }));
    expect(json.returned).toBe(1);
    expect(json.total).toBe(2);
  });

  it("propagates fromCache and cacheAge from ghCachedExec", async () => {
    mockIsGhAvailable.mockResolvedValueOnce(true);
    mockGhCachedExec.mockResolvedValueOnce({
      data: sampleRepos,
      fromCache: true,
      cacheAge: 42,
    });
    const json = parseJson(await repoListOp.execute({ org: "org" }, ctx));
    expect(json.from_cache).toBe(true);
    expect(json.cache_age_seconds).toBe(42);
  });
});

// ─── prListOp.execute ─────────────────────────────────────────────────────

describe("prListOp.execute", () => {
  const samplePrs = [
    {
      number: 1,
      title: "feat: add foo",
      state: "OPEN",
      author: { login: "alice" },
      url: "u1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      baseRefName: "main",
      headRefName: "f1",
      labels: [{ name: "enhancement" }],
      reviewDecision: null,
      additions: 1,
      deletions: 0,
      changedFiles: 1,
    },
    {
      number: 2,
      title: "fix: bug",
      state: "OPEN",
      author: { login: "bob" },
      url: "u2",
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      baseRefName: "develop",
      headRefName: "f2",
      labels: [{ name: "bug" }],
      reviewDecision: "APPROVED",
      additions: 2,
      deletions: 1,
      changedFiles: 1,
    },
    {
      number: 3,
      title: "chore: foo cleanup",
      state: "OPEN",
      author: { login: "alice" },
      url: "u3",
      createdAt: "2026-01-03T00:00:00Z",
      updatedAt: "2026-01-03T00:00:00Z",
      baseRefName: "main",
      headRefName: "f3",
      labels: [],
      reviewDecision: null,
      additions: 5,
      deletions: 2,
      changedFiles: 2,
    },
  ];

  function callPrList(args: Parameters<typeof prListOp.execute>[0]) {
    mockIsGhAvailable.mockResolvedValueOnce(true);
    mockGhCachedExec.mockResolvedValueOnce({ data: samplePrs, fromCache: false });
    return prListOp.execute(args, ctx);
  }

  it.each([
    {
      label: "filters by author (case-insensitive)",
      args: { repo: "o/r", author: "ALICE" } as const,
      expectedNumbers: [1, 3],
    },
    {
      label: "filters by base branch",
      args: { repo: "o/r", base: "develop" } as const,
      expectedNumbers: [2],
    },
    {
      label: "filters by query (substring in title)",
      args: { repo: "o/r", query: "foo" } as const,
      expectedNumbers: [1, 3],
    },
    {
      label: "filters by label (case-insensitive)",
      args: { repo: "o/r", label: "Bug" } as const,
      expectedNumbers: [2],
    },
  ])("$label", async ({ args, expectedNumbers }) => {
    const json = parseJson(await callPrList(args));
    expect((json.prs as { number: number }[]).map((p) => p.number)).toEqual(expectedNumbers);
    expect(json.total).toBe(expectedNumbers.length);
  });

  it("respects limit while reporting total prior to slicing", async () => {
    const json = parseJson(await callPrList({ repo: "o/r", limit: 1 }));
    expect(json.returned).toBe(1);
    expect(json.total).toBe(3);
  });

  it("uses cacheKey based on repo and state and forwards forceRefresh", async () => {
    mockIsGhAvailable.mockResolvedValueOnce(true);
    mockGhCachedExec.mockResolvedValueOnce({ data: [], fromCache: false });
    await prListOp.execute(
      { repo: "o/r", state: "merged", force_refresh: true, ttl_minutes: 10 },
      ctx,
    );
    expect(mockGhCachedExec).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: "pr-list-o/r-merged",
        forceRefresh: true,
        ttlMs: 10 * 60 * 1000,
      }),
    );
    const callArgs = mockGhCachedExec.mock.calls[0][0].args;
    expect(callArgs).toContain("--state");
    expect(callArgs).toContain("merged");
  });
});

// ─── prCommentsOp.execute ─────────────────────────────────────────────────

describe("prCommentsOp.execute", () => {
  const sampleReviews = [
    {
      author: { login: "alice" },
      body: "Looks good",
      state: "APPROVED",
      createdAt: "2026-01-02T00:00:00Z",
      comments: [],
    },
    {
      author: { login: "coderabbit-ai" },
      body: "Issues found",
      state: "CHANGES_REQUESTED",
      createdAt: "2026-01-01T00:00:00Z",
      comments: [],
    },
  ];

  // The duplicate entry (same author/path/line/body) must be deduped.
  const sampleReviewComments = [
    {
      author: { login: "alice" },
      body: "nit: rename",
      createdAt: "2026-01-02T00:01:00Z",
      path: "src/foo.ts",
      line: 10,
      startLine: null,
      diffHunk: "@@",
    },
    {
      author: { login: "alice" },
      body: "nit: rename",
      createdAt: "2026-01-02T00:02:00Z",
      path: "src/foo.ts",
      line: 10,
      startLine: null,
      diffHunk: "@@",
    },
  ];

  function callPrComments(args: Parameters<typeof prCommentsOp.execute>[0]) {
    mockIsGhAvailable.mockResolvedValueOnce(true);
    mockGhCachedExec
      .mockResolvedValueOnce({ data: sampleReviews, fromCache: false })
      .mockResolvedValueOnce({ data: sampleReviewComments, fromCache: false });
    return prCommentsOp.execute(args, ctx);
  }

  it("classifies bots and humans, sorts by createdAt, and dedupes", async () => {
    const json = parseJson(await callPrComments({ repo: "o/r", pr_number: 1 }));
    const summary = json.summary as { total: number; human: number; bot: number };
    expect(summary).toEqual({ total: 3, human: 2, bot: 1 });
    const comments = json.comments as { author: string; created_at: string }[];
    expect(comments.map((c) => c.author)).toEqual(["coderabbit-ai", "alice", "alice"]);
    expect(comments[0].created_at < comments[1].created_at).toBe(true);
  });

  it.each([
    { filter: "human" as const, expectedTotal: 2, expectedBotFlag: false },
    { filter: "bot" as const, expectedTotal: 1, expectedBotFlag: true },
  ])("filters to $filter only", async ({ filter, expectedTotal, expectedBotFlag }) => {
    const json = parseJson(
      await callPrComments({ repo: "o/r", pr_number: 1, filter }),
    );
    expect(json.filter).toBe(filter);
    expect(json.total).toBe(expectedTotal);
    const comments = json.comments as { is_bot: boolean }[];
    expect(comments.every((c) => c.is_bot === expectedBotFlag)).toBe(true);
  });

  it("respects the limit", async () => {
    const json = parseJson(await callPrComments({ repo: "o/r", pr_number: 1, limit: 1 }));
    expect(json.returned).toBe(1);
  });

  it("forwards forceRefresh and ttl_minutes to both ghCachedExec calls", async () => {
    await callPrComments({
      repo: "o/r",
      pr_number: 7,
      force_refresh: true,
      ttl_minutes: 15,
    });
    const calls = mockGhCachedExec.mock.calls;
    expect(calls).toHaveLength(2);
    for (const [params] of calls) {
      expect(params.forceRefresh).toBe(true);
      expect(params.ttlMs).toBe(15 * 60 * 1000);
    }
    expect(calls[0][0].cacheKey).toBe("pr-comments-o/r-7-reviews");
    expect(calls[1][0].cacheKey).toBe("pr-comments-o/r-7-review-comments");
  });
});
