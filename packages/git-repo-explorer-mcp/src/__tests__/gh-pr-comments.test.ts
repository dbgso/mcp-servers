import { describe, it, expect } from "vitest";
import { isBot, flattenReviews } from "../operations/gh-pr-comments-ops.js";

describe("isBot", () => {
  it.each([
    { login: "dependabot[bot]", expected: true },
    { login: "github-actions", expected: true },
    { login: "dependabot", expected: true },
    { login: "renovate", expected: true },
    { login: "copilot", expected: true },
    { login: "coderabbit-ai", expected: true },
    { login: "CodeRabbit", expected: true },
    { login: "claude-assistant", expected: true },
    { login: "devin-ai-integration", expected: true },
    { login: "snyk-bot", expected: true },
    { login: "sonarcloud-bot", expected: true },
  ])("returns true for bot: $login", ({ login, expected }) => {
    expect(isBot(login)).toBe(expected);
  });

  it.each([
    { login: "octocat" },
    { login: "alice" },
    { login: "bob-dev" },
    { login: "my-username" },
  ])("returns false for human: $login", ({ login }) => {
    expect(isBot(login)).toBe(false);
  });
});

describe("flattenReviews", () => {
  it("returns an empty array for no reviews", () => {
    expect(flattenReviews([])).toEqual([]);
  });

  it("emits a top-level entry for non-empty review body", () => {
    const result = flattenReviews([
      {
        author: { login: "alice" },
        body: "LGTM",
        state: "APPROVED",
        createdAt: "2026-01-01T00:00:00Z",
        comments: [],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      author: "alice",
      is_bot: false,
      body: "LGTM",
      path: null,
      line: null,
      review_state: "APPROVED",
    });
  });

  it("skips reviews with empty or whitespace-only bodies", () => {
    const result = flattenReviews([
      {
        author: { login: "alice" },
        body: "",
        state: "COMMENTED",
        createdAt: "2026-01-01T00:00:00Z",
        comments: [],
      },
      {
        author: { login: "alice" },
        body: "   ",
        state: "COMMENTED",
        createdAt: "2026-01-02T00:00:00Z",
        comments: [],
      },
    ]);
    expect(result).toEqual([]);
  });

  it("flattens inline review comments and marks bot authors", () => {
    const result = flattenReviews([
      {
        author: { login: "coderabbit-ai" },
        body: "Found issues",
        state: "CHANGES_REQUESTED",
        createdAt: "2026-01-01T00:00:00Z",
        comments: [
          {
            author: { login: "coderabbit-ai" },
            body: "nit",
            createdAt: "2026-01-01T00:00:01Z",
            path: "src/foo.ts",
            line: 42,
            startLine: 40,
            diffHunk: "@@ -40,3 +40,3 @@",
          },
        ],
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].is_bot).toBe(true);
    expect(result[1]).toMatchObject({
      author: "coderabbit-ai",
      is_bot: true,
      body: "nit",
      path: "src/foo.ts",
      line: 42,
      start_line: 40,
      diff_hunk: "@@ -40,3 +40,3 @@",
      review_state: "CHANGES_REQUESTED",
    });
  });

  it("treats missing comments array as empty", () => {
    const result = flattenReviews([
      {
        author: { login: "alice" },
        body: "Looks good",
        state: "APPROVED",
        createdAt: "2026-01-01T00:00:00Z",
        comments: undefined as unknown as never,
      },
    ]);
    expect(result).toHaveLength(1);
  });
});
