import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GitOperation } from "./types.js";
import { gitBranchList } from "../git-repo-manager.js";

const branchListArgsSchema = z.object({
  repo_url: z.string().optional().describe("Repository URL (omit for current working directory)"),
  pattern: z.string().optional().describe("Filter pattern (e.g., feature/*)"),
});
type BranchListArgs = z.infer<typeof branchListArgsSchema>;

export const branchListOp: GitOperation<BranchListArgs> = {
  id: "branch_list",
  summary: "List branches",
  detail: `List branches in the repository. Filter by pattern.

Examples:
  operation: "branch_list"
  params: {}
  params: { repo_url: "git@github.com:org/repo.git" }
  params: { pattern: "feature/*" }`,
  category: "Reference",
  argsSchema: branchListArgsSchema,
  execute: async (args, ctx): Promise<CallToolResult> => {
    const branches = await gitBranchList(ctx.repoPath, {
      pattern: args.pattern,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          repo: ctx.repoName,
          total: branches.length,
          branches,
        }, null, 2),
      }],
    };
  },
};

export const branchOperations = [branchListOp];
