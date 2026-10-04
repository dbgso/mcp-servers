import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { jsonResponse } from "mcp-shared";
import type { GitOperation } from "./types.js";
import { ghCachedExec, parseJsonLines } from "../gh-cache.js";
import { ghUnavailableResponse } from "./gh-guard.js";

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

/**
 * The non-empty review bodies, as comments carrying the review's state.
 * Inline comments are fetched from the pulls/comments endpoint instead.
 */
export function reviewBodies(reviews: GhReview[]): ClassifiedComment[] {
  return reviews
    .filter((review) => review.body?.trim())
    .map((review) => ({
      author: review.author.login,
      is_bot: isBot(review.author.login),
      body: review.body,
      path: null,
      line: null,
      start_line: null,
      diff_hunk: null,
      created_at: review.createdAt,
      review_state: review.state,
    }));
}

/** An inline review comment. Its review's state is not fetched, so it is null. */
export function inlineComment(c: GhComment): ClassifiedComment {
  return {
    author: c.author.login,
    is_bot: isBot(c.author.login),
    body: c.body,
    path: c.path,
    line: c.line,
    start_line: c.startLine,
    diff_hunk: c.diffHunk,
    created_at: c.createdAt,
    review_state: null,
  };
}

/**
 * Review bodies and inline comments in one list, oldest first, without
 * repeats of the same author, place and body.
 */
export function mergeComments(params: {
  reviews: GhReview[];
  reviewComments: GhComment[];
}): ClassifiedComment[] {
  const all = [...reviewBodies(params.reviews), ...params.reviewComments.map(inlineComment)];
  all.sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Deduplicate by body+author+path+line
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = `${c.author}:${c.path}:${c.line}:${(c.body ?? "").slice(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const COMMENT_FILTERS = ["all", "human", "bot"] as const;
type CommentFilter = (typeof COMMENT_FILTERS)[number];

/** Which comments each `filter` value keeps. */
export const FILTERS: Record<CommentFilter, (c: ClassifiedComment) => boolean> = {
  all: () => true,
  human: (c) => !c.is_bot,
  bot: (c) => c.is_bot,
};

/** Fetch a PR's reviews and inline review comments through the gh cache. */
async function fetchPrComments(params: {
  repo: string;
  prNumber: number;
  ttlMs: number;
  forceRefresh: boolean | undefined;
}): Promise<{ reviews: GhReview[]; reviewComments: GhComment[]; fromCache: boolean; cacheAge?: number }> {
  const { repo, prNumber, ttlMs, forceRefresh } = params;
  const cacheKey = `pr-comments-${repo}-${prNumber}`;

  const {
    data: reviews,
    fromCache,
    cacheAge,
  } = await ghCachedExec<GhReview[]>({
    args: [
      "api",
      `repos/${repo}/pulls/${prNumber}/reviews`,
      "--paginate",
      "--jq",
      // One object per line: gh applies --jq to each page separately
      ".[] | {author: .user, body: .body, state: .state, createdAt: .submitted_at}",
    ],
    cacheKey: `${cacheKey}-reviews`,
    parse: parseJsonLines<GhReview>,
    ttlMs,
    forceRefresh,
  });

  const { data: reviewComments } = await ghCachedExec<GhComment[]>({
    args: [
      "api",
      `repos/${repo}/pulls/${prNumber}/comments`,
      "--paginate",
      "--jq",
      ".[] | {author: .user, body: .body, createdAt: .created_at, path: .path, line: .line, startLine: .start_line, diffHunk: .diff_hunk, pullRequestReviewId: .pull_request_review_id}",
    ],
    cacheKey: `${cacheKey}-review-comments`,
    parse: parseJsonLines<GhComment>,
    ttlMs,
    forceRefresh,
  });

  return { reviews, reviewComments, fromCache, cacheAge };
}

const prCommentsArgsSchema = z.object({
  repo: z.string().describe("Repository in owner/repo format (required)"),
  pr_number: z.number().int().min(1).describe("Pull request number (required)"),
  filter: z.enum(COMMENT_FILTERS).optional().describe("Filter by comment author type (default: all)"),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum comments to return (default: 50)"),
  force_refresh: z.boolean().optional().describe("Bypass cache and fetch fresh data"),
  ttl_minutes: z.number().int().min(1).max(60).optional().describe("Cache TTL in minutes (default: 3)"),
});
type PrCommentsArgs = z.infer<typeof prCommentsArgsSchema>;

export class PrCommentsOp implements GitOperation<PrCommentsArgs> {
  readonly id = "pr_comments";
  readonly summary = "Get PR review comments classified as human or bot (requires gh CLI)";
  readonly detail = `Fetch PR review comments and classify each as human or bot/AI.
Use filter to get only human or bot comments. Results are cached.
Requires gh CLI to be installed and authenticated.

Known bot patterns: [bot] suffix, github-actions, dependabot, renovate,
copilot, coderabbit, codacy, sonarcloud, deepsource, snyk, devin-ai, claude.

Examples:
  operation: "pr_comments"
  params: { repo: "dbgso/mcp-servers", pr_number: 123 }
  params: { repo: "dbgso/mcp-servers", pr_number: 123, filter: "bot" }
  params: { repo: "dbgso/mcp-servers", pr_number: 123, filter: "human", limit: 20 }`;
  readonly category = "GitHub";
  readonly argsSchema = prCommentsArgsSchema;
  async execute(args: PrCommentsArgs): Promise<CallToolResult> {
    const unavailable = await ghUnavailableResponse();
    if (unavailable) return unavailable;

    const limit = args.limit ?? 50;
    const filter = args.filter ?? "all";
    const { reviews, reviewComments, fromCache, cacheAge } = await fetchPrComments({
      repo: args.repo,
      prNumber: args.pr_number,
      ttlMs: (args.ttl_minutes ?? 3) * 60 * 1000,
      forceRefresh: args.force_refresh,
    });

    const deduped = mergeComments({ reviews, reviewComments });
    const filtered = deduped.filter(FILTERS[filter]);
    const botCount = deduped.filter(FILTERS.bot).length;
    const humanCount = deduped.filter(FILTERS.human).length;
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
  }
}

export const prCommentsOp = new PrCommentsOp();

export const prCommentsOperations = [prCommentsOp];
