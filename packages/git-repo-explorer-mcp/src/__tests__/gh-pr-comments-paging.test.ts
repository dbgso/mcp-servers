/**
 * pr_comments against a stand-in for `gh api --paginate --jq`.
 *
 * gh applies the --jq filter to each page on its own and prints each value
 * it produces on its own line. A filter that wraps a page in `[...]` therefore
 * prints one array per page, which is not one JSON document once a PR has more
 * than one page of reviews or comments.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, rmSync } from "node:fs";

const { execFilePromiseMock } = vi.hoisted(() => ({
  execFilePromiseMock: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const execFile = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[
    Symbol.for("nodejs.util.promisify.custom")
  ] = execFilePromiseMock;
  return { execFile };
});

const { setCacheDir } = await import("../gh-cache.js");
const { prCommentsOp } = await import("../operations/gh-pr-comments-ops.js");

const testCacheDir = join(tmpdir(), `gh-paging-test-${Date.now()}`);

const reviewPages = [
  [{ author: { login: "alice" }, body: "page one review", state: "COMMENTED", createdAt: "2026-01-01T00:00:00Z" }],
  [{ author: { login: "bob" }, body: "page two review", state: "APPROVED", createdAt: "2026-01-03T00:00:00Z" }],
];

const commentPages = [
  [{ author: { login: "carol" }, body: "first", createdAt: "2026-01-02T00:00:00Z", path: "a.ts", line: 1, startLine: null, diffHunk: "@@" }],
  [{ author: { login: "dependabot[bot]" }, body: "second", createdAt: "2026-01-04T00:00:00Z", path: "b.ts", line: 2, startLine: null, diffHunk: "@@" }],
];

/** Print what gh prints: the --jq filter's results for each page, one value per line. */
function fakeGh(_cmd: string, args: string[]): { stdout: string; stderr: string } {
  if (args[0] === "auth") return { stdout: "", stderr: "" };
  const jq = args[args.indexOf("--jq") + 1];
  const pages = args[1].endsWith("/reviews") ? reviewPages : commentPages;
  const values = pages.flatMap((page) => (jq.startsWith("[") ? [page] : page));
  return { stdout: values.map((v) => JSON.stringify(v)).join("\n") + "\n", stderr: "" };
}

beforeAll(() => {
  setCacheDir(testCacheDir);
  execFilePromiseMock.mockImplementation(async (cmd: string, args: string[]) => fakeGh(cmd, args));
});

afterAll(() => {
  if (existsSync(testCacheDir)) {
    rmSync(testCacheDir, { recursive: true, force: true });
  }
});

describe("pr_comments over more than one page", () => {
  it("returns the reviews and comments of every page", async () => {
    const result = await prCommentsOp.execute(
      { repo: "o/r", pr_number: 1, force_refresh: true },
      { repoPath: "/tmp/x", repoName: "x" },
    );

    expect(result.isError).toBeFalsy();
    const json = JSON.parse((result.content[0] as { text: string }).text) as {
      comments: { author: string }[];
    };
    expect(json.comments.map((c) => c.author)).toEqual(["alice", "carol", "bob", "dependabot[bot]"]);
  });
});
