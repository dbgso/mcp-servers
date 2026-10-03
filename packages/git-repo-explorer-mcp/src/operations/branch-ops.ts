import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GitOperation, GitOperationContext } from "./types.js";
import { gitBranchList } from "../git-repo-manager.js";

const branchListArgsSchema = z.object({
  repo_url: z.string().optional().describe("Repository URL (omit for current working directory)"),
  pattern: z.string().optional().describe("Filter pattern (e.g., feature/*)"),
});
type BranchListArgs = z.infer<typeof branchListArgsSchema>;

export class BranchListOp implements GitOperation<BranchListArgs> {
  readonly id = "branch_list";
  readonly summary = "List branches";
  readonly detail = `List branches in the repository. Filter by pattern.

Examples:
  operation: "branch_list"
  params: {}
  params: { repo_url: "git@github.com:org/repo.git" }
  params: { pattern: "feature/*" }`;
  readonly category = "Reference";
  readonly argsSchema = branchListArgsSchema;
  async execute(args: BranchListArgs, ctx: GitOperationContext): Promise<CallToolResult> {
    const branches = await gitBranchList({
      repoPath: ctx.repoPath,
      options: { pattern: args.pattern },
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
  }
}

export const branchListOp = new BranchListOp();

export const branchOperations = [branchListOp];
