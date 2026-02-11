import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GitOperation } from "./types.js";
import { gitLog } from "../git-repo-manager.js";

export const logOp: GitOperation = {
  id: "log",
  summary: "Get commit history",
  detail: `Show commit history with git log. Filter by author, date range, or message.

Examples:
  operation: "log"
  params: { ref: "main", max_count: 10 }
  params: { repo_url: "git@github.com:org/repo.git", author: "username", since: "2025-01-01" }
  params: { path: "src/lib/mcp", grep: "fix", max_count: 20 }`,
  category: "History",
  argsSchema: z.object({
    repo_url: z.string().optional().describe("Repository URL (omit for current working directory)"),
    ref: z.string().optional().describe('Branch name or commit hash (default: "HEAD")'),
    path: z.string().optional().describe("Show history for specific path only"),
    max_count: z.number().int().min(1).max(100).optional().describe("Maximum commits to show (default: 20, max: 100)"),
    author: z.string().optional().describe("Filter by author name"),
    since: z.string().optional().describe("Show commits after date (e.g., 2025-01-01)"),
    until: z.string().optional().describe("Show commits before date (e.g., 2025-12-31)"),
    grep: z.string().optional().describe("Search pattern for commit messages"),
  }),
  execute: async (args, ctx): Promise<CallToolResult> => {
    const ref = args.ref ?? "HEAD";
    const output = await gitLog(ctx.repoPath, ref, {
      path: args.path,
      max_count: args.max_count,
      author: args.author,
      since: args.since,
      until: args.until,
      grep: args.grep,
    });

    const commits = output
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [hash, date, author, ...messageParts] = line.split("\t");
        return { hash, date, author, message: messageParts.join("\t") };
      });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          repo: ctx.repoName,
          ref,
          total_commits: commits.length,
          commits,
        }, null, 2),
      }],
    };
  },
};

export const logOperations: GitOperation[] = [logOp];
