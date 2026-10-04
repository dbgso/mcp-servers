import { describe, it, expect } from "vitest";
import { isBot, reviewBodies, inlineComment, mergeComments, FILTERS } from "../operations/gh-pr-comments-ops.js";

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

const inline = {
  author: { login: "dependabot[bot]" },
  body: "bump",
  createdAt: "2026-01-01T00:00:00Z",
  path: "package.json",
  line: 3,
  startLine: 2,
  diffHunk: "@@",
};

describe("inlineComment", () => {
  it("maps an inline comment, with no review state", () => {
    expect(inlineComment(inline)).toEqual({
      author: "dependabot[bot]",
      is_bot: true,
      body: "bump",
      path: "package.json",
      line: 3,
      start_line: 2,
      diff_hunk: "@@",
      created_at: "2026-01-01T00:00:00Z",
      review_state: null,
    });
  });
});

describe("mergeComments", () => {
  it("puts review bodies and inline comments in time order and drops repeats", () => {
    const merged = mergeComments({
      reviews: [{ author: { login: "alice" }, body: "LGTM", state: "APPROVED", createdAt: "2026-01-02T00:00:00Z" }],
      reviewComments: [inline, { ...inline, createdAt: "2026-01-03T00:00:00Z" }],
    });
    expect(merged.map((c) => [c.author, c.created_at])).toEqual([
      ["dependabot[bot]", "2026-01-01T00:00:00Z"],
      ["alice", "2026-01-02T00:00:00Z"],
    ]);
  });
});

describe("FILTERS", () => {
  const bot = inlineComment(inline);
  const human = { ...bot, is_bot: false };

  it.each([
    { filter: "all" as const, keeps: [bot, human] },
    { filter: "human" as const, keeps: [human] },
    { filter: "bot" as const, keeps: [bot] },
  ])("$filter keeps the right comments", ({ filter, keeps }) => {
    expect([bot, human].filter(FILTERS[filter])).toEqual(keeps);
  });
});
