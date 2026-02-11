import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GitOperation } from "./types.js";
import { gitShow } from "../git-repo-manager.js";

export const showOp: GitOperation = {
  id: "show",
  summary: "Show commit details or file content",
  detail: `Show commit details or file content with git show.
If path is specified, shows the file content at that ref.
If path is omitted, shows the commit details (including diff).

Examples:
  Commit details:
  operation: "show"
  params: { ref: "abc1234" }

  File content:
  params: { ref: "main", path: "src/lib/mcp/index.ts" }
  params: { repo_url: "git@github.com:org/repo.git", ref: "HEAD", path: "package.json" }`,
  category: "File",
  argsSchema: z.object({
    repo_url: z.string().optional().describe("Repository URL (omit for current working directory)"),
    ref: z.string().describe("Commit hash or branch name (required)"),
    path: z.string().optional().describe("File path (omit to show commit details)"),
  }),
  execute: async (args, ctx): Promise<CallToolResult> => {
    const output = await gitShow(ctx.repoPath, args.ref, args.path);

    return {
      content: [{
        type: "text",
        text: args.path
          ? JSON.stringify({ repo: ctx.repoName, ref: args.ref, path: args.path, content: output }, null, 2)
          : output,
      }],
    };
  },
};

export const showOperations: GitOperation[] = [showOp];
