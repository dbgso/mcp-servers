import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { jsonResponse, errorResponse } from "mcp-shared";
import type { GitOperation } from "./types.js";
import { ghCachedExec, isGhAvailable } from "../gh-cache.js";

interface GhComment {
  author: { login: string };
  body: string;
  createdAt: string;
  path: string | null;
  line: number | null;
  startLine: number | null;
  diffHunk: string | null;
}

interface GhReview {
  author: { login: string };
  body: string;
  state: string;
  createdAt: string;
  comments: GhComment[];
}

interface ClassifiedComment {
  author: string;
  is_bot: boolean;
  body: string;
  path: string | null;
  line: number | null;
  start_line: number | null;
  diff_hunk: string | null;
  created_at: string;
  review_state: string | null;
}

const BOT_PATTERNS = [
  /\[bot\]$/,
  /^github-actions$/,
  /^dependabot$/,
  /^renovate$/,
  /^copilot$/,
  /^coderabbit/i,
  /^codacy/i,
  /^sonarcloud/i,
  /^deepsource/i,
  /^snyk/i,
  /^devin-ai/i,
  /^claude/i,
];

export function isBot(login: string): boolean {
  return BOT_PATTERNS.some((p) => p.test(login));
}

export function flattenReviews(reviews: GhReview[]): ClassifiedComment[] {
  const comments: ClassifiedComment[] = [];

  for (const review of reviews) {
    // Review body itself (if non-empty)
    if (review.body?.trim()) {
      comments.push({
        author: review.author.login,
        is_bot: isBot(review.author.login),
        body: review.body,
        path: null,
        line: null,
        start_line: null,
        diff_hunk: null,
        created_at: review.createdAt,
        review_state: review.state,
      });
    }

    // Inline review comments
    for (const c of review.comments ?? []) {
      comments.push({
        author: c.author.login,
        is_bot: isBot(c.author.login),
        body: c.body,
        path: c.path,
        line: c.line,
        start_line: c.startLine,
        diff_hunk: c.diffHunk,
        created_at: c.createdAt,
        review_state: review.state,
      });
    }
  }

  return comments;
}

const prCommentsArgsSchema = z.object({
  repo: z.string().describe("Repository in owner/repo format (required)"),
  pr_number: z.number().int().min(1).describe("Pull request number (required)"),
  filter: z.enum(["all", "human", "bot"]).optional().describe("Filter by comment author type (default: all)"),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum comments to return (default: 50)"),
  force_refresh: z.boolean().optional().describe("Bypass cache and fetch fresh data"),
  ttl_minutes: z.number().int().min(1).max(60).optional().describe("Cache TTL in minutes (default: 3)"),
});
type PrCommentsArgs = z.infer<typeof prCommentsArgsSchema>;

export const prCommentsOp: GitOperation<PrCommentsArgs> = {
  id: "pr_comments",
  summary: "Get PR review comments classified as human or bot (requires gh CLI)",
  detail: `Fetch PR review comments and classify each as human or bot/AI.
Use filter to get only human or bot comments. Results are cached.
Requires gh CLI to be installed and authenticated.

Known bot patterns: [bot] suffix, github-actions, dependabot, renovate,
copilot, coderabbit, codacy, sonarcloud, deepsource, snyk, devin-ai, claude.

Examples:
  operation: "pr_comments"
  params: { repo: "dbgso/mcp-servers", pr_number: 123 }
  params: { repo: "dbgso/mcp-servers", pr_number: 123, filter: "bot" }
  params: { repo: "dbgso/mcp-servers", pr_number: 123, filter: "human", limit: 20 }`,
  category: "GitHub",
  argsSchema: prCommentsArgsSchema,
  execute: async (args): Promise<CallToolResult> => {
    if (!(await isGhAvailable())) {
      return errorResponse(
        "gh CLI is not installed or not authenticated. Run `gh auth login` first.",
      );
    }

    const ttlMs = (args.ttl_minutes ?? 3) * 60 * 1000;
    const limit = args.limit ?? 50;
    const cacheKey = `pr-comments-${args.repo}-${args.pr_number}`;

    const {
      data: reviews,
      fromCache,
      cacheAge,
    } = await ghCachedExec<GhReview[]>({
      args: [
        "api",
        `repos/${args.repo}/pulls/${args.pr_number}/reviews`,
        "--paginate",
        "--jq",
        "[.[] | {author: .user, body: .body, state: .state, createdAt: .submitted_at, comments: []}]",
      ],
      cacheKey: `${cacheKey}-reviews`,
      ttlMs,
      forceRefresh: args.force_refresh,
    });

    const { data: reviewComments } = await ghCachedExec<GhComment[]>({
      args: [
        "api",
        `repos/${args.repo}/pulls/${args.pr_number}/comments`,
        "--paginate",
        "--jq",
        "[.[] | {author: .user, body: .body, createdAt: .created_at, path: .path, line: .line, startLine: .start_line, diffHunk: .diff_hunk, pullRequestReviewId: .pull_request_review_id}]",
      ],
      cacheKey: `${cacheKey}-review-comments`,
      ttlMs,
      forceRefresh: args.force_refresh,
    });

    // Merge inline comments into their parent reviews
    const allComments = flattenReviews(reviews);

    // Add standalone review comments not captured by reviews
    for (const c of reviewComments) {
      allComments.push({
        author: c.author.login,
        is_bot: isBot(c.author.login),
        body: c.body,
        path: c.path,
        line: c.line,
        start_line: c.startLine,
        diff_hunk: c.diffHunk,
        created_at: c.createdAt,
        review_state: null,
      });
    }

    // Sort by created_at
    allComments.sort((a, b) => a.created_at.localeCompare(b.created_at));

    // Deduplicate by body+author+path+line
    const seen = new Set<string>();
    const deduped = allComments.filter((c) => {
      const key = `${c.author}:${c.path}:${c.line}:${(c.body ?? "").slice(0, 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter by type
    const filter = args.filter ?? "all";
    const filtered = deduped.filter((c) => {
      if (filter === "human") return !c.is_bot;
      if (filter === "bot") return c.is_bot;
      return true;
    });

    const botCount = deduped.filter((c) => c.is_bot).length;
    const humanCount = deduped.filter((c) => !c.is_bot).length;
    const limited = filtered.slice(0, limit);

    return jsonResponse({
      repo: args.repo,
      pr_number: args.pr_number,
      filter,
      summary: { total: deduped.length, human: humanCount, bot: botCount },
      comments: limited,
      total: filtered.length,
      returned: limited.length,
      from_cache: fromCache,
      cache_age_seconds: cacheAge,
    });
  },
};

export const prCommentsOperations = [prCommentsOp];
