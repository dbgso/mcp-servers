import { describe, it, expect } from "vitest";
import { isBot, reviewBodies } from "../operations/gh-pr-comments-ops.js";

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

describe("reviewBodies", () => {
  it("returns an empty array for no reviews", () => {
    expect(reviewBodies([])).toEqual([]);
  });

  it("emits a top-level entry for non-empty review body", () => {
    const result = reviewBodies([
      {
        author: { login: "alice" },
        body: "LGTM",
        state: "APPROVED",
        createdAt: "2026-01-01T00:00:00Z",
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
    const result = reviewBodies([
      {
        author: { login: "alice" },
        body: "",
        state: "COMMENTED",
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        author: { login: "alice" },
        body: "   ",
        state: "COMMENTED",
        createdAt: "2026-01-02T00:00:00Z",
      },
    ]);
    expect(result).toEqual([]);
  });

  it("marks a bot's review body as a bot comment", () => {
    const result = reviewBodies([
      {
        author: { login: "coderabbit-ai" },
        body: "Found issues",
        state: "CHANGES_REQUESTED",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(result).toEqual([
      {
        author: "coderabbit-ai",
        is_bot: true,
        body: "Found issues",
        path: null,
        line: null,
        start_line: null,
        diff_hunk: null,
        created_at: "2026-01-01T00:00:00Z",
        review_state: "CHANGES_REQUESTED",
      },
    ]);
  });
});
