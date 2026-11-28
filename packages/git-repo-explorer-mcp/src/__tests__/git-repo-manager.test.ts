/**
 * The module that actually runs git, against a repository built for the test.
 *
 * Every operation in this server is a thin wrapper over one of these functions,
 * and the operations are tested with this module mocked -- so the argument
 * vectors handed to git, the parsing of what comes back, and the bare-versus-
 * working-tree difference had no coverage at all (21% of it ran).
 *
 * The repository here is a real one made with `git init`: three commits, two
 * branches, a tag, and a file that moved. A clone is taken from it by path,
 * which is how `ensureRepo` can be exercised without a network.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setBaseDir,
  getBaseDir,
  resolveRepo,
  extractRepoName,
  getRepoPath,
  ensureRepo,
  parseGitGrepOutput,
  gitGrep,
  gitLsFiles,
  gitLog,
  gitBlame,
  gitShow,
  gitDiff,
  gitBranchList,
  gitTagList,
} from "../git-repo-manager.js";

const run = promisify(execFile);

let root: string;
let workTree: string;
let baseDir: string;
let firstCommit: string;
let originalBaseDir: string;

/** A repository with enough history for every operation to have something to find. */
async function buildRepository(dir: string): Promise<void> {
  const git = (...args: string[]) => run("git", args, { cwd: dir });

  await git("init", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test User");
  await git("config", "commit.gpgsign", "false");

  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "README.md"), "# Fixture\n\nA needle in here.\n", "utf-8");
  await writeFile(join(dir, "src", "app.ts"), "export const NEEDLE = 1;\n", "utf-8");
  await git("add", ".");
  await git("commit", "-m", "first: add the readme and the app");

  await writeFile(join(dir, "src", "app.ts"), "export const NEEDLE = 2;\nexport const other = 3;\n", "utf-8");
  await git("add", ".");
  await git("commit", "-m", "second: change the constant");
  await git("tag", "v1.0.0");

  await git("checkout", "-b", "feature/branch");
  await writeFile(join(dir, "src", "feature.ts"), "export const feature = true;\n", "utf-8");
  await git("add", ".");
  await git("commit", "-m", "third: add a feature");
  await git("checkout", "main");
}

beforeAll(async () => {
  originalBaseDir = getBaseDir();
  root = await mkdtemp(join(tmpdir(), "git-explorer-"));
  workTree = join(root, "fixture-repo");
  baseDir = join(root, "cache");
  await mkdir(workTree, { recursive: true });
  await buildRepository(workTree);
  setBaseDir(baseDir);
  const { stdout } = await run("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: workTree });
  firstCommit = stdout.trim();
}, 60_000);

afterAll(async () => {
  setBaseDir(originalBaseDir);
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("naming a repository", () => {
  it.each([
    { url: "git@github.com:org/repo.git", expected: "repo" },
    { url: "https://github.com/org/repo.git", expected: "repo" },
    { url: "https://github.com/org/repo", expected: "repo" },
    { url: "/local/path/to/repo", expected: "repo" },
    { url: "ssh://git@host:2222/org/repo.git", expected: "repo" },
  ])("reads $expected out of $url", ({ url, expected }) => {
    expect(extractRepoName(url)).toBe(expected);
  });

  it("refuses a URL with no name in it", () => {
    expect(() => extractRepoName("///")).toThrow(/Cannot extract/);
  });

  it("puts the clone under the configured base directory", () => {
    expect(getRepoPath("https://github.com/org/repo.git")).toBe(join(baseDir, "repo"));
  });
});

describe("making a repository available", () => {
  it("clones one it has not seen, as a bare repo", async () => {
    const repoPath = await ensureRepo(workTree);

    expect(repoPath).toBe(join(baseDir, "fixture-repo"));
    expect(existsSync(join(repoPath, "HEAD"))).toBe(true);
    // Bare: no working tree beside it.
    expect(existsSync(join(repoPath, ".git"))).toBe(false);
  }, 30_000);

  it("fetches one it already has instead of cloning again", async () => {
    await ensureRepo(workTree);

    const repoPath = await ensureRepo(workTree);

    expect(existsSync(join(repoPath, "HEAD"))).toBe(true);
  }, 30_000);

  it("re-clones when the copy on disk can no longer be fetched into", async () => {
    // A cache directory that was emptied, or a clone interrupted half way, is
    // still a directory -- so "it exists" is not enough to trust it.
    const repoPath = await ensureRepo(workTree);
    rmSync(join(repoPath, "objects"), { recursive: true, force: true });
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const again = await ensureRepo(workTree);

    expect(stderr.mock.calls.flat().join(" ")).toContain("re-cloning");
    expect(existsSync(join(again, "objects"))).toBe(true);
  }, 60_000);

  it("resolves a URL to the clone, and no URL to the working repository", async () => {
    const remote = await resolveRepo(workTree);
    expect(remote.repoName).toBe("fixture-repo");
    expect(remote.repoPath).toBe(join(baseDir, "fixture-repo"));

    const local = await resolveRepo();
    // Local mode asks git for the root of the current directory, which under
    // the test runner is this repository.
    expect(local.repoPath.length).toBeGreaterThan(0);
    expect(local.repoName).toBe(local.repoPath.split("/").pop());
  }, 30_000);
});

describe("grep", () => {
  it("finds matches and reports where they are", async () => {
    const result = await gitGrep({ repoPath: workTree, pattern: "NEEDLE" });

    expect(result.total_matches).toBeGreaterThan(0);
    expect(result.matches[0]).toMatchObject({ file: expect.stringContaining("app.ts") });
    expect(result.matches[0].line).toBeGreaterThan(0);
    expect(result.ref).toBe("HEAD");
    expect(result.truncated).toBe(false);
  });

  it("raises an error that is not just 'no matches'", async () => {
    // Exit 1 means no matches; anything else -- a bad ref, a broken pathspec
    // -- has to reach the caller rather than read as an empty result.
    await expect(
      gitGrep({ repoPath: workTree, pattern: "NEEDLE", options: { ref: "no-such-ref" } })
    ).rejects.toThrow();
  });

  it("finds nothing without failing, when a pattern does not appear", async () => {
    // git grep exits 1 for "no matches", which is not an error condition.
    const result = await gitGrep({ repoPath: workTree, pattern: "haystack-only" });

    expect(result.matches).toEqual([]);
    expect(result.total_matches).toBe(0);
  });

  it("can be told to ignore case", async () => {
    const sensitive = await gitGrep({ repoPath: workTree, pattern: "needle" });
    const insensitive = await gitGrep({
      repoPath: workTree,
      pattern: "needle",
      options: { ignore_case: true },
    });

    expect(insensitive.total_matches).toBeGreaterThan(sensitive.total_matches);
  });

  it("can be limited to a path, and says when it stopped early", async () => {
    const result = await gitGrep({
      repoPath: workTree,
      pattern: "NEEDLE",
      options: { path: "src", max_count: 1 },
    });

    expect(result.matches.every((m) => m.file.startsWith("src/"))).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("searches the ref it is given", async () => {
    const result = await gitGrep({
      repoPath: workTree,
      pattern: "feature",
      options: { ref: "feature/branch" },
    });

    expect(result.ref).toBe("feature/branch");
    expect(result.total_matches).toBeGreaterThan(0);
  });
});

describe("parsing grep output", () => {
  it("returns nothing for empty output", () => {
    expect(parseGitGrepOutput({ output: "   \n", ref: "HEAD" })).toEqual([]);
  });

  it("keeps a colon that belongs to the matched line", () => {
    // Source lines contain colons constantly. Splitting on every one would
    // truncate the match at the first of them.
    const matches = parseGitGrepOutput({
      output: "HEAD:src/app.ts:12:const url = 'https://example.com';",
      ref: "HEAD",
    });

    expect(matches).toEqual([
      { file: "src/app.ts", line: 12, content: "const url = 'https://example.com';" },
    ]);
  });

  it.each([
    { name: "no colon at all", line: "not a grep line" },
    { name: "a file but no line number", line: "HEAD:src/app.ts" },
    { name: "a line number that is not a number", line: "HEAD:src/app.ts:xx:content" },
  ])("skips a line with $name", ({ line }) => {
    // git grep's output is parsed by position, and a line that does not fit
    // is a line this parser cannot place. Guessing would put a match at the
    // wrong file or line, which is worse than dropping it.
    expect(parseGitGrepOutput({ output: `${line}\n`, ref: "HEAD" })).toEqual([]);
  });
});

describe("listing files", () => {
  it("lists everything at a ref", async () => {
    const files = await gitLsFiles({ repoPath: workTree });

    expect(files).toContain("README.md");
    expect(files).toContain("src/app.ts");
  });

  it("can be limited to a path", async () => {
    const files = await gitLsFiles({ repoPath: workTree, options: { path: "src" } });

    expect(files.every((f) => f.startsWith("src/"))).toBe(true);
  });

  it("filters by a glob over the whole path", async () => {
    // `ls-tree` takes a path prefix, not a glob, so the pattern is applied
    // afterwards -- which is the only way `**/*.ts` can match at all.
    const typescript = await gitLsFiles({ repoPath: workTree, options: { pattern: "**/*.ts" } });
    const readme = await gitLsFiles({ repoPath: workTree, options: { pattern: "*.md" } });

    expect(typescript).toContain("src/app.ts");
    expect(typescript).not.toContain("README.md");
    expect(readme).toEqual(["README.md"]);
  });

  it("raises whatever git said when the ref does not exist", async () => {
    // "unknown revision" is the useful message; swallowing it would report an
    // empty repository instead.
    await expect(
      gitLsFiles({ repoPath: workTree, ref: "no-such-ref" })
    ).rejects.toThrow();
  });

  it("lists a different ref's files", async () => {
    const files = await gitLsFiles({ repoPath: workTree, ref: "feature/branch" });

    expect(files).toContain("src/feature.ts");
  });
});

describe("log", () => {
  it("reports commits newest first, one per line", async () => {
    const out = await gitLog({ repoPath: workTree });

    const lines = out.split("\n");
    expect(lines[0]).toContain("second: change the constant");
    expect(lines[lines.length - 1]).toContain("first:");
  });

  it("honours every filter it takes", async () => {
    const byAuthor = await gitLog({ repoPath: workTree, options: { author: "Test User" } });
    expect(byAuthor).toContain("first:");

    const byGrep = await gitLog({ repoPath: workTree, options: { grep: "second" } });
    expect(byGrep).toContain("second:");
    expect(byGrep).not.toContain("first:");

    const byPath = await gitLog({ repoPath: workTree, options: { path: "README.md" } });
    expect(byPath).toContain("first:");

    const since = await gitLog({ repoPath: workTree, options: { since: "2000-01-01" } });
    expect(since).toContain("second:");

    const until = await gitLog({ repoPath: workTree, options: { until: "now" } });
    expect(until).toContain("second:");

    const limited = await gitLog({ repoPath: workTree, options: { max_count: 1 } });
    expect(limited.split("\n")).toHaveLength(1);
  });
});

describe("blame", () => {
  it("attributes every line of a file", async () => {
    const out = await gitBlame({ repoPath: workTree, filePath: "src/app.ts" });

    expect(out).toContain("Test User");
  });

  it("can be limited to a range, or to everything from a line on", async () => {
    const range = await gitBlame({
      repoPath: workTree,
      filePath: "src/app.ts",
      options: { line_start: 1, line_end: 1 },
    });
    const fromLine = await gitBlame({
      repoPath: workTree,
      filePath: "src/app.ts",
      options: { line_start: 2 },
    });

    expect(range).toContain("Test User");
    expect(fromLine).toContain("Test User");
  });
});

describe("show", () => {
  it("shows a commit", async () => {
    const out = await gitShow({ repoPath: workTree, ref: firstCommit });

    expect(out).toContain("first: add the readme");
  });

  it("shows a file at a ref, rather than the commit", async () => {
    const out = await gitShow({ repoPath: workTree, ref: "HEAD", filePath: "src/app.ts" });

    expect(out).toContain("NEEDLE = 2");
    expect(out).not.toContain("commit ");
  });
});

describe("diff", () => {
  it("reports what changed between two refs", async () => {
    const out = await gitDiff({ repoPath: workTree, refFrom: firstCommit, refTo: "HEAD" });

    expect(out).toContain("NEEDLE = 2");
    expect(out).toContain("src/app.ts");
  });

  it("can be limited to a path", async () => {
    const out = await gitDiff({
      repoPath: workTree,
      refFrom: firstCommit,
      refTo: "HEAD",
      options: { path: "README.md" },
    });

    expect(out).not.toContain("src/app.ts");
  });
});

describe("branches", () => {
  it("lists them from a working repository", async () => {
    const branches = await gitBranchList({ repoPath: workTree });

    expect(branches).toContain("main");
    expect(branches).toContain("feature/branch");
  });

  it("lists them from a bare clone, where `git branch` would answer differently", async () => {
    const bare = await ensureRepo(workTree);

    const branches = await gitBranchList({ repoPath: bare });

    expect(branches).toContain("main");
  }, 30_000);

  it.each([
    { pattern: "main", expected: ["main"] },
    { pattern: "feature/*", expected: ["feature/branch"] },
    { pattern: "feature/**", expected: ["feature/branch"] },
    { pattern: "mai?", expected: ["main"] },
    { pattern: "nothing-*", expected: [] },
  ])("filters by the glob $pattern", async ({ pattern, expected }) => {
    const branches = await gitBranchList({ repoPath: workTree, options: { pattern } });

    expect(branches.filter((b) => !b.startsWith("remotes/"))).toEqual(expected);
  });
});

describe("tags", () => {
  it("lists them", async () => {
    expect(await gitTagList({ repoPath: workTree })).toEqual(["v1.0.0"]);
  });

  it("filters by pattern and by count", async () => {
    expect(await gitTagList({ repoPath: workTree, options: { pattern: "v1.*" } })).toEqual([
      "v1.0.0",
    ]);
    expect(await gitTagList({ repoPath: workTree, options: { max_count: 1 } })).toHaveLength(1);
    expect(await gitTagList({ repoPath: workTree, options: { pattern: "none-*" } })).toEqual([]);
  });
});
