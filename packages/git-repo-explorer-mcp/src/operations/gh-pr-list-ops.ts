import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { jsonResponse, errorResponse } from "mcp-shared";
import type { GitOperation } from "./types.js";
import { ghCachedExec, isGhAvailable } from "../gh-cache.js";

interface GhPr {
  number: number;
  title: string;
  state: string;
  author: { login: string };
  url: string;
  createdAt: string;
  updatedAt: string;
  baseRefName: string;
  headRefName: string;
  labels: { name: string }[];
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
}

const prListArgsSchema = z.object({
  repo: z.string().describe("Repository in owner/repo format (required)"),
  state: z.enum(["open", "closed", "merged", "all"]).optional().describe("PR state filter (default: open)"),
  author: z.string().optional().describe("Filter by author login"),
  base: z.string().optional().describe("Filter by base branch"),
  query: z.string().optional().describe("Filter by title (substring match)"),
  label: z.string().optional().describe("Filter by label"),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum PRs to return (default: 50)"),
  force_refresh: z.boolean().optional().describe("Bypass cache and fetch fresh data"),
  ttl_minutes: z.number().int().min(1).max(60).optional().describe("Cache TTL in minutes (default: 3)"),
});
type PrListArgs = z.infer<typeof prListArgsSchema>;

export const prListOp: GitOperation<PrListArgs> = {
  id: "pr_list",
  summary: "List pull requests in a repository (requires gh CLI)",
  detail: `List pull requests with filtering. Results are cached to avoid rate limits.
Requires gh CLI to be installed and authenticated.

Examples:
  operation: "pr_list"
  params: { repo: "dbgso/mcp-servers" }
  params: { repo: "dbgso/mcp-servers", state: "open", author: "username" }
  params: { repo: "dbgso/mcp-servers", state: "merged", base: "main", limit: 10 }`,
  category: "GitHub",
  argsSchema: prListArgsSchema,
  execute: async (args): Promise<CallToolResult> => {
    if (!(await isGhAvailable())) {
      return errorResponse(
        "gh CLI is not installed or not authenticated. Run `gh auth login` first.",
      );
    }

    const state = args.state ?? "open";
    const ttlMs = (args.ttl_minutes ?? 3) * 60 * 1000;
    const limit = args.limit ?? 50;

    const ghArgs = [
      "pr",
      "list",
      "-R",
      args.repo,
      "--json",
      "number,title,state,author,url,createdAt,updatedAt,baseRefName,headRefName,labels,reviewDecision,additions,deletions,changedFiles",
      "--limit",
      "300",
      "--state",
      state,
    ];

    const cacheKey = `pr-list-${args.repo}-${state}`;

    const {
      data: prs,
      fromCache,
      cacheAge,
    } = await ghCachedExec<GhPr[]>({
      args: ghArgs,
      cacheKey,
      ttlMs,
      forceRefresh: args.force_refresh,
    });

    let filtered = prs.filter((pr) => {
      if (args.author && pr.author.login.toLowerCase() !== args.author.toLowerCase()) return false;
      if (args.base && pr.baseRefName !== args.base) return false;
      if (args.query && !pr.title.toLowerCase().includes(args.query.toLowerCase())) return false;
      if (args.label && !pr.labels.some((l) => l.name.toLowerCase() === args.label?.toLowerCase()))
        return false;
      return true;
    });

    const total = filtered.length;
    filtered = filtered.slice(0, limit);

    return jsonResponse({
      repo: args.repo,
      state,
      prs: filtered.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.author.login,
        url: pr.url,
        base: pr.baseRefName,
        head: pr.headRefName,
        labels: pr.labels.map((l) => l.name),
        review_decision: pr.reviewDecision,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changedFiles,
        created_at: pr.createdAt,
        updated_at: pr.updatedAt,
      })),
      total,
      returned: filtered.length,
      from_cache: fromCache,
      cache_age_seconds: cacheAge,
    });
  },
};

export const prListOperations = [prListOp];
