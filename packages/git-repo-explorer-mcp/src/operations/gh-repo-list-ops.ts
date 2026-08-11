import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { jsonResponse, errorResponse } from "mcp-shared";
import type { GitOperation } from "./types.js";
import { ghCachedExec, isGhAvailable } from "../gh-cache.js";

interface GhRepo {
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  sshUrl: string;
  isArchived: boolean;
  isPrivate: boolean;
  defaultBranchRef: { name: string } | null;
  updatedAt: string;
  primaryLanguage: { name: string } | null;
}

const repoListArgsSchema = z.object({
  org: z.string().describe("GitHub organization or user name (required)"),
  query: z.string().optional().describe("Filter repos by name (substring match)"),
  include_archived: z.boolean().optional().describe("Include archived repos (default: false)"),
  language: z.string().optional().describe("Filter by primary language (e.g., TypeScript)"),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum repos to return (default: 50)"),
  force_refresh: z.boolean().optional().describe("Bypass cache and fetch fresh data"),
  ttl_minutes: z.number().int().min(1).max(60).optional().describe("Cache TTL in minutes (default: 5)"),
});
type RepoListArgs = z.infer<typeof repoListArgsSchema>;

export const repoListOp: GitOperation<RepoListArgs> = {
  id: "repo_list",
  summary: "List GitHub repositories in an organization (requires gh CLI)",
  detail: `List repositories in a GitHub organization. Results are cached to avoid rate limits.
Use query to filter by name, language to filter by primary language.
Requires gh CLI to be installed and authenticated.

Examples:
  operation: "repo_list"
  params: { org: "dbgso" }
  params: { org: "dbgso", query: "mcp", limit: 10 }
  params: { org: "dbgso", language: "TypeScript", force_refresh: true }`,
  category: "GitHub",
  argsSchema: repoListArgsSchema,
  execute: async (args): Promise<CallToolResult> => {
    if (!(await isGhAvailable())) {
      return errorResponse(
        "gh CLI is not installed or not authenticated. Run `gh auth login` first.",
      );
    }

    const ttlMs = (args.ttl_minutes ?? 5) * 60 * 1000;
    const limit = args.limit ?? 50;

    const {
      data: repos,
      fromCache,
      cacheAge,
    } = await ghCachedExec<GhRepo[]>({
      args: [
        "repo",
        "list",
        args.org,
        "--json",
        "name,nameWithOwner,description,url,sshUrl,isArchived,isPrivate,defaultBranchRef,updatedAt,primaryLanguage",
        "--limit",
        "1000",
      ],
      cacheKey: `repo-list-${args.org}`,
      ttlMs,
      forceRefresh: args.force_refresh,
    });

    let filtered = repos.filter((repo) => {
      if (!args.include_archived && repo.isArchived) return false;
      if (args.query && !repo.name.toLowerCase().includes(args.query.toLowerCase())) return false;
      if (
        args.language &&
        repo.primaryLanguage?.name?.toLowerCase() !== args.language.toLowerCase()
      ) return false;
      return true;
    });

    const total = filtered.length;
    filtered = filtered.slice(0, limit);

    return jsonResponse({
      org: args.org,
      repos: filtered.map((r) => ({
        name: r.name,
        full_name: r.nameWithOwner,
        description: r.description,
        url: r.url,
        ssh_url: r.sshUrl,
        default_branch: r.defaultBranchRef?.name ?? null,
        language: r.primaryLanguage?.name ?? null,
        is_private: r.isPrivate,
        is_archived: r.isArchived,
        updated_at: r.updatedAt,
      })),
      total,
      returned: filtered.length,
      from_cache: fromCache,
      cache_age_seconds: cacheAge,
    });
  },
};

export const repoListOperations = [repoListOp];
