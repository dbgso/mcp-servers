import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const BASE_DIR = "/tmp/git-grep-repos";

/**
 * Resolve repository path and name.
 * - repo_url specified → ensureRepo (bare clone/fetch) then return remote path
 * - repo_url omitted → use local working directory (current git repo)
 */
export async function resolveRepo(repoUrl?: string): Promise<{ repoPath: string; repoName: string }> {
  if (repoUrl) {
    const repoPath = await ensureRepo(repoUrl);
    const repoName = extractRepoName(repoUrl);
    return { repoPath, repoName };
  }
  // Local mode: find git root of cwd
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { timeout: 5_000 });
  const repoPath = stdout.trim();
  const repoName = path.basename(repoPath);
  return { repoPath, repoName };
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export interface GrepResult {
  repo: string;
  ref: string;
  pattern: string;
  matches: GrepMatch[];
  total_matches: number;
  truncated: boolean;
}

export interface GitGrepOptions {
  ref?: string | undefined;
  path?: string | undefined;
  ignore_case?: boolean | undefined;
  max_count?: number | undefined;
}

/**
 * Extract repository name from URL.
 * Handles both SSH (git@github.com:org/repo.git) and HTTPS (https://github.com/org/repo.git) formats.
 */
export function extractRepoName(repoUrl: string): string {
  // Remove trailing .git if present
  const cleaned = repoUrl.replace(/\.git$/, "");
  // Get last path segment (works for both SSH and HTTPS)
  const segments = cleaned.split(/[/:]/).filter(Boolean);
  const name = segments[segments.length - 1];
  if (!name) {
    throw new Error(`Cannot extract repository name from URL: ${repoUrl}`);
  }
  return name;
}

/**
 * Get the local bare repo path for a given repo URL.
 */
export function getRepoPath(repoUrl: string): string {
  const repoName = extractRepoName(repoUrl);
  return path.join(BASE_DIR, repoName);
}

/**
 * Ensure the repository is available locally.
 * Clones as bare repo if not present, fetches if already present.
 * Returns the path to the bare repository.
 */
export async function ensureRepo(repoUrl: string): Promise<string> {
  const repoPath = getRepoPath(repoUrl);

  if (existsSync(repoPath)) {
    // Fetch latest changes
    await execFileAsync("git", ["fetch", "--all", "--prune"], {
      cwd: repoPath,
      timeout: 60_000,
    });
  } else {
    // Clone as bare repo
    await execFileAsync("git", ["clone", "--bare", repoUrl, repoPath], {
      timeout: 120_000,
    });
  }

  return repoPath;
}

/**
 * Parse git grep output into structured matches.
 * Expected format: "<ref>:<file>:<line>:<content>"
 */
export function parseGitGrepOutput(output: string, ref: string): GrepMatch[] {
  if (!output.trim()) {
    return [];
  }

  const lines = output.trim().split("\n");
  const matches: GrepMatch[] = [];
  const refPrefix = `${ref}:`;

  for (const line of lines) {
    // Format: ref:file:lineNumber:content
    if (!line.startsWith(refPrefix)) {
      continue;
    }

    const afterRef = line.slice(refPrefix.length);
    // Find the first colon-separated number to split file:line:content
    const firstColon = afterRef.indexOf(":");
    if (firstColon === -1) continue;

    const remaining = afterRef.slice(firstColon + 1);
    const secondColon = remaining.indexOf(":");
    if (secondColon === -1) continue;

    const file = afterRef.slice(0, firstColon);
    const lineNum = Number.parseInt(remaining.slice(0, secondColon), 10);
    const content = remaining.slice(secondColon + 1);

    if (Number.isNaN(lineNum)) continue;

    matches.push({ file, line: lineNum, content });
  }

  return matches;
}

/**
 * Execute git grep on a bare repository.
 */
export async function gitGrep(
  repoPath: string,
  pattern: string,
  options: GitGrepOptions = {},
): Promise<GrepResult> {
  const ref = options.ref ?? "HEAD";
  const maxCount = Math.min(options.max_count ?? 100, 500);

  const args = ["grep", "-n"];
  if (options.ignore_case) {
    args.push("-i");
  }
  args.push(`--max-count=${maxCount}`);
  args.push(pattern);
  args.push(ref);

  if (options.path) {
    args.push("--", options.path);
  }

  const repoName = path.basename(repoPath);

  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    const matches = parseGitGrepOutput(stdout, ref);
    const truncated = matches.length >= maxCount;

    return {
      repo: repoName,
      ref,
      pattern,
      matches,
      total_matches: matches.length,
      truncated,
    };
  } catch (error) {
    // git grep exits with code 1 when no matches found
    if (error instanceof Error && "code" in error && (error as { code: number }).code === 1) {
      return {
        repo: repoName,
        ref,
        pattern,
        matches: [],
        total_matches: 0,
        truncated: false,
      };
    }
    throw error;
  }
}

// ─── New git command functions ────────────────────────────────────────────

export interface LsFilesOptions {
  path?: string;
  pattern?: string;
}

export interface LogOptions {
  path?: string;
  max_count?: number;
  author?: string;
  since?: string;
  until?: string;
  grep?: string;
}

export interface BlameOptions {
  line_start?: number;
  line_end?: number;
}

export interface DiffOptions {
  path?: string;
}

/**
 * List files in a repository at a given ref.
 * Uses `git ls-tree --name-only -r <ref> [-- <path>]`
 */
export async function gitLsFiles(
  repoPath: string,
  ref: string = "HEAD",
  options: LsFilesOptions = {},
): Promise<string[]> {
  const args = ["ls-tree", "--name-only", "-r", ref];

  if (options.path) {
    args.push("--", options.path);
  }

  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  let files = stdout.trim().split("\n").filter(Boolean);

  if (options.pattern) {
    const globToRegex = (glob: string) => {
      const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "___GLOBSTAR___")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/___GLOBSTAR___/g, ".*");
      return new RegExp(`^${escaped}$`);
    };
    const regex = globToRegex(options.pattern);
    files = files.filter(f => regex.test(f));
  }

  return files;
}

/**
 * Get commit log from a repository.
 * Uses `git log --format=...`
 */
export async function gitLog(
  repoPath: string,
  ref: string = "HEAD",
  options: LogOptions = {},
): Promise<string> {
  const maxCount = Math.min(options.max_count ?? 20, 100);

  const args = [
    "log",
    `--format=%H%x09%ai%x09%an%x09%s`,
    `-${maxCount}`,
    ref,
  ];

  if (options.author) {
    args.push(`--author=${options.author}`);
  }
  if (options.since) {
    args.push(`--since=${options.since}`);
  }
  if (options.until) {
    args.push(`--until=${options.until}`);
  }
  if (options.grep) {
    args.push(`--grep=${options.grep}`);
  }
  if (options.path) {
    args.push("--", options.path);
  }

  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.trim();
}

/**
 * Get blame information for a file.
 * Uses `git blame <ref> -- <path>`
 */
export async function gitBlame(
  repoPath: string,
  ref: string = "HEAD",
  filePath: string,
  options: BlameOptions = {},
): Promise<string> {
  const args = ["blame", "--porcelain"];

  if (options.line_start && options.line_end) {
    args.push(`-L${options.line_start},${options.line_end}`);
  } else if (options.line_start) {
    args.push(`-L${options.line_start},`);
  }

  args.push(ref, "--", filePath);

  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.trim();
}

/**
 * Show commit or file content.
 * `git show <ref>` for commit detail, `git show <ref>:<path>` for file content.
 */
export async function gitShow(
  repoPath: string,
  ref: string,
  filePath?: string,
): Promise<string> {
  const target = filePath ? `${ref}:${filePath}` : ref;
  const args = ["show", target];

  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout;
}

/**
 * Show diff between two refs.
 * Uses `git diff <refFrom> <refTo> [-- <path>]`
 */
export async function gitDiff(
  repoPath: string,
  refFrom: string,
  refTo: string,
  options: DiffOptions = {},
): Promise<string> {
  const args = ["diff", refFrom, refTo];

  if (options.path) {
    args.push("--", options.path);
  }

  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout;
}

export interface BranchListOptions {
  pattern?: string;
}

/**
 * List branches in a repository.
 * For bare repos: `git for-each-ref --format='%(refname:short)' refs/heads/`
 * For local repos: `git branch -a --format='%(refname:short)'`
 */
export async function gitBranchList(
  repoPath: string,
  options: BranchListOptions = {},
): Promise<string[]> {
  const isBare = existsSync(path.join(repoPath, "HEAD")) && !existsSync(path.join(repoPath, ".git"));

  const args = isBare
    ? ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]
    : ["branch", "-a", "--format=%(refname:short)"];

  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  let branches = stdout.trim().split("\n").filter(Boolean);

  if (options.pattern) {
    const globToRegex = (glob: string) => {
      const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "___GLOBSTAR___")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/___GLOBSTAR___/g, ".*");
      return new RegExp(`^${escaped}$`);
    };
    const regex = globToRegex(options.pattern);
    branches = branches.filter(b => regex.test(b));
  }

  return branches;
}

export interface TagListOptions {
  pattern?: string;
  max_count?: number;
}

/**
 * List tags in a repository, sorted by newest first.
 * Uses `git tag --list --sort=-creatordate`
 */
export async function gitTagList(
  repoPath: string,
  options: TagListOptions = {},
): Promise<string[]> {
  const args = ["tag", "--list", "--sort=-creatordate"];

  if (options.pattern) {
    args.push(options.pattern);
  }

  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  let tags = stdout.trim().split("\n").filter(Boolean);

  if (options.max_count) {
    tags = tags.slice(0, options.max_count);
  }

  return tags;
}
