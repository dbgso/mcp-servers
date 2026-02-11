import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GitOperation } from "./types.js";
import { gitGrep } from "../git-repo-manager.js";

export const grepOp: GitOperation = {
  id: "grep",
  summary: "Search code in repository with pattern",
  detail: `Execute git grep to search code. Regular expressions are supported.

Examples:
  operation: "grep"
  params: { pattern: "TODO" }
  params: { repo_url: "git@github.com:org/repo.git", pattern: "fetchUser", ref: "main", path: "packages/common-lib/src" }
  params: { pattern: "console\\.log", ignore_case: true, max_count: 50 }`,
  category: "Search",
  argsSchema: z.object({
    repo_url: z.string().optional().describe("Repository URL (omit for current working directory)"),
    pattern: z.string().describe("Search pattern (required). Regular expressions supported"),
    ref: z.string().optional().describe('Branch name or commit hash (default: "HEAD")'),
    path: z.string().optional().describe('Target path (e.g., "packages/common-lib/src")'),
    ignore_case: z.boolean().optional().describe("Case insensitive search (default: false)"),
    max_count: z.number().int().min(1).max(500).optional().describe("Maximum results (default: 100, max: 500)"),
  }),
  execute: async (args, ctx): Promise<CallToolResult> => {
    const result = await gitGrep(ctx.repoPath, args.pattern, {
      ref: args.ref,
      path: args.path,
      ignore_case: args.ignore_case,
      max_count: args.max_count,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
};

export const grepOperations: GitOperation[] = [grepOp];
