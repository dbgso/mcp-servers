import { describe, test, expect, vi, beforeEach } from "vitest";
import { extractRepoName, parseGitGrepOutput } from "../git-repo-manager.js";
import { allOperations, getOperation, getCategories, getOperationsByCategory } from "../operations/registry.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

vi.mock("../git-repo-manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../git-repo-manager.js")>();
  return {
    ...actual,
    ensureRepo: vi.fn(),
    resolveRepo: vi.fn(),
    gitGrep: vi.fn(),
    gitLsFiles: vi.fn(),
    gitLog: vi.fn(),
    gitBlame: vi.fn(),
    gitShow: vi.fn(),
    gitDiff: vi.fn(),
    gitBranchList: vi.fn(),
    gitTagList: vi.fn(),
  };
});

import { gitGrep, gitLsFiles, gitLog, gitBlame, gitShow, gitDiff, gitBranchList, gitTagList } from "../git-repo-manager.js";

const mockGitGrep = vi.mocked(gitGrep);
const mockGitLsFiles = vi.mocked(gitLsFiles);
const mockGitLog = vi.mocked(gitLog);
const mockGitBlame = vi.mocked(gitBlame);
const mockGitShow = vi.mocked(gitShow);
const mockGitDiff = vi.mocked(gitDiff);
const mockGitBranchList = vi.mocked(gitBranchList);
const mockGitTagList = vi.mocked(gitTagList);

function getText(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}

// ─── git-repo-manager unit tests ──────────────────────────────────────────

describe("extractRepoName", () => {
  test.each([
    { desc: "SSH URL with .git", input: "git@github.com:org/repo.git", expected: "repo" },
    { desc: "HTTPS URL with .git", input: "https://github.com/org/repo.git", expected: "repo" },
    { desc: "SSH URL without .git", input: "git@github.com:org/repo", expected: "repo" },
    { desc: "HTTPS URL without .git", input: "https://github.com/org/repo", expected: "repo" },
    { desc: "nested path", input: "git@github.com:org/sub/deep-repo.git", expected: "deep-repo" },
  ])("should extract repo name from $desc", ({ input, expected }) => {
    expect(extractRepoName(input)).toBe(expected);
  });

  test("should throw for empty/invalid URL", () => {
    expect(() => extractRepoName("")).toThrow();
  });
});

describe("parseGitGrepOutput", () => {
  test("should parse standard git grep output", () => {
    const output = [
      "main:src/utils.ts:42:  const searchPattern = 'test';",
      "main:src/index.ts:10:  import { searchPattern } from './utils';",
    ].join("\n");

    const result = parseGitGrepOutput(output, "main");
    expect(result).toEqual([
      { file: "src/utils.ts", line: 42, content: "  const searchPattern = 'test';" },
      { file: "src/index.ts", line: 10, content: "  import { searchPattern } from './utils';" },
    ]);
  });

  test("should return empty array for empty output", () => {
    expect(parseGitGrepOutput("", "main")).toEqual([]);
    expect(parseGitGrepOutput("  \n  ", "main")).toEqual([]);
  });

  test("should handle output with colons in content", () => {
    const output = "HEAD:config.ts:5:  url: 'https://example.com:8080/api';";
    const result = parseGitGrepOutput(output, "HEAD");
    expect(result).toEqual([
      { file: "config.ts", line: 5, content: "  url: 'https://example.com:8080/api';" },
    ]);
  });

  test("should skip lines with non-matching ref prefix", () => {
    expect(parseGitGrepOutput("other-branch:file.ts:1:content", "main")).toEqual([]);
  });

  test("should handle commit hash as ref", () => {
    const output = "abc1234:src/file.ts:99:  return true;";
    expect(parseGitGrepOutput(output, "abc1234")).toEqual([
      { file: "src/file.ts", line: 99, content: "  return true;" },
    ]);
  });

  test("should skip malformed lines", () => {
    const output = ["main:valid.ts:1:good line", "main:invalid-no-line-number", "main:valid2.ts:2:another good line"].join("\n");
    const result = parseGitGrepOutput(output, "main");
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe("valid.ts");
    expect(result[1].file).toBe("valid2.ts");
  });
});

// ─── Operation Registry tests ─────────────────────────────────────────────

describe("Git Operation Registry", () => {
  test("should have 8 operations registered", () => {
    expect(allOperations).toHaveLength(8);
  });

  test("all operations have required fields", () => {
    for (const op of allOperations) {
      expect(op.id).toBeTruthy();
      expect(op.summary).toBeTruthy();
      expect(op.detail).toBeTruthy();
      expect(op.category).toBeTruthy();
      expect(op.argsSchema).toBeTruthy();
      expect(typeof op.execute).toBe("function");
    }
  });

  test("all operation ids are unique", () => {
    const ids = allOperations.map(op => op.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(["grep", "ls_files", "log", "blame", "show", "diff", "branch_list", "tag_list"])("getOperation returns %s", (id) => {
    const op = getOperation(id);
    expect(op).toBeDefined();
    expect(op!.id).toBe(id);
  });

  test("getOperation returns undefined for unknown id", () => {
    expect(getOperation("nonexistent")).toBeUndefined();
  });

  test.each(["Search", "File", "History", "Reference"])("includes category: %s", (category) => {
    expect(getCategories()).toContain(category);
  });

  test("getOperationsByCategory groups correctly", () => {
    const byCategory = getOperationsByCategory();
    expect(byCategory["Search"]).toHaveLength(1);
    expect(byCategory["File"]).toHaveLength(2);
    expect(byCategory["History"]).toHaveLength(3);
    expect(byCategory["Reference"]).toHaveLength(2);
  });
});

// ─── Operation execution tests ────────────────────────────────────────────

describe("Operation Execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("grep operation", () => {
    test("executes grep with all options", async () => {
      mockGitGrep.mockResolvedValue({
        repo: "repo",
        ref: "main",
        pattern: "TODO",
        matches: [{ file: "src/index.ts", line: 10, content: "// TODO: fix this" }],
        total_matches: 1,
        truncated: false,
      });

      const op = getOperation("grep")!;
      const result = await op.execute(
        { pattern: "TODO", ref: "main" },
        { repoPath: "/tmp/git-grep-repos/repo", repoName: "repo" }
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getText(result));
      expect(parsed.repo).toBe("repo");
      expect(parsed.matches).toHaveLength(1);
    });
  });

  describe("ls_files operation", () => {
    test("executes ls_files", async () => {
      mockGitLsFiles.mockResolvedValue(["src/index.ts", "src/utils.ts"]);

      const op = getOperation("ls_files")!;
      const result = await op.execute(
        { path: "src" },
        { repoPath: "/tmp/git-grep-repos/repo", repoName: "repo" }
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getText(result));
      expect(parsed.total_files).toBe(2);
      expect(parsed.files).toEqual(["src/index.ts", "src/utils.ts"]);
    });
  });

  describe("log operation", () => {
    test("executes log and parses output", async () => {
      mockGitLog.mockResolvedValue("abc1234\t2025-01-01 12:00:00 +0900\tAuthor\tInitial commit");

      const op = getOperation("log")!;
      const result = await op.execute(
        { max_count: 5 },
        { repoPath: "/tmp/git-grep-repos/repo", repoName: "repo" }
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getText(result));
      expect(parsed.total_commits).toBe(1);
      expect(parsed.commits[0].hash).toBe("abc1234");
      expect(parsed.commits[0].author).toBe("Author");
      expect(parsed.commits[0].message).toBe("Initial commit");
    });
  });

  describe("blame operation", () => {
    test("executes blame", async () => {
      const blameOutput = [
        "abc1234567890123456789012345678901234567 1 1 1",
        "author John Doe",
        "author-mail <john@example.com>",
        "author-time 1700000000",
        "author-tz +0900",
        "committer John Doe",
        "committer-mail <john@example.com>",
        "committer-time 1700000000",
        "committer-tz +0900",
        "summary Initial commit",
        "filename src/index.ts",
        "\tconst x = 1;",
      ].join("\n");
      mockGitBlame.mockResolvedValue(blameOutput);

      const op = getOperation("blame")!;
      const result = await op.execute(
        { path: "src/index.ts" },
        { repoPath: "/tmp/git-grep-repos/repo", repoName: "repo" }
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getText(result));
      expect(parsed.total_lines).toBe(1);
      expect(parsed.lines[0].author).toBe("John Doe");
      expect(parsed.lines[0].content).toBe("const x = 1;");
    });
  });

  describe("show operation", () => {
    test("executes show for file content", async () => {
      mockGitShow.mockResolvedValue('const x = 1;\nexport default x;\n');

      const op = getOperation("show")!;
      const result = await op.execute(
        { ref: "main", path: "src/index.ts" },
        { repoPath: "/tmp/git-grep-repos/repo", repoName: "repo" }
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getText(result));
      expect(parsed.path).toBe("src/index.ts");
      expect(parsed.content).toContain("const x = 1;");
    });

    test("executes show for commit detail", async () => {
      mockGitShow.mockResolvedValue("commit abc1234\nAuthor: John\n\nInitial commit\n");

      const op = getOperation("show")!;
      const result = await op.execute(
        { ref: "abc1234" },
        { repoPath: "/tmp/git-grep-repos/repo", repoName: "repo" }
      );

      expect(result.isError).toBeUndefined();
      expect(getText(result)).toContain("commit abc1234");
    });
  });

  describe("diff operation", () => {
    test("executes diff", async () => {
      mockGitDiff.mockResolvedValue("diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n");

      const op = getOperation("diff")!;
      const result = await op.execute(
        { ref_from: "main", ref_to: "develop" },
        { repoPath: "/tmp/git-grep-repos/repo", repoName: "repo" }
      );

      expect(result.isError).toBeUndefined();
      expect(getText(result)).toContain("diff --git");
    });

    test("returns message for no differences", async () => {
      mockGitDiff.mockResolvedValue("");

      const op = getOperation("diff")!;
      const result = await op.execute(
        { ref_from: "main", ref_to: "main" },
        { repoPath: "/tmp/git-grep-repos/repo", repoName: "repo" }
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getText(result));
      expect(parsed.message).toContain("No differences");
    });
  });

  describe("branch_list operation", () => {
    test("executes branch_list", async () => {
      mockGitBranchList.mockResolvedValue(["main", "develop", "feature/auth"]);

      const op = getOperation("branch_list")!;
      const result = await op.execute(
        {},
        { repoPath: "/tmp/git-grep-repos/repo", repoName: "repo" }
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getText(result));
      expect(parsed.repo).toBe("repo");
      expect(parsed.total).toBe(3);
      expect(parsed.branches).toEqual(["main", "develop", "feature/auth"]);
    });
  });

  describe("tag_list operation", () => {
    test("executes tag_list", async () => {
      mockGitTagList.mockResolvedValue(["v2.1.0", "v2.0.0", "v1.0.0"]);

      const op = getOperation("tag_list")!;
      const result = await op.execute(
        {},
        { repoPath: "/tmp/git-grep-repos/repo", repoName: "repo" }
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(getText(result));
      expect(parsed.repo).toBe("repo");
      expect(parsed.total).toBe(3);
      expect(parsed.tags).toEqual(["v2.1.0", "v2.0.0", "v1.0.0"]);
    });
  });
});
