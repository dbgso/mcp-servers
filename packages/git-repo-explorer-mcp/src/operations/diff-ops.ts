import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GitOperation } from "./types.js";
import { gitDiff } from "../git-repo-manager.js";

const diffArgsSchema = z.object({
  repo_url: z.string().optional().describe("Repository URL (omit for current working directory)"),
  ref_from: z.string().describe("Source ref (required)"),
  ref_to: z.string().describe("Target ref (required)"),
  path: z.string().optional().describe("Filter diff by path"),
});
type DiffArgs = z.infer<typeof diffArgsSchema>;

export const diffOp: GitOperation<DiffArgs> = {
  id: "diff",
  summary: "Show diff between two refs",
  detail: `Show diff between two refs with git diff. Optionally filter by path.

Examples:
  operation: "diff"
  params: { ref_from: "main", ref_to: "develop" }
  params: { repo_url: "git@github.com:org/repo.git", ref_from: "v1.0.0", ref_to: "v2.0.0", path: "src/" }
  params: { ref_from: "HEAD~5", ref_to: "HEAD" }`,
  category: "History",
  argsSchema: diffArgsSchema,
  execute: async (args, ctx): Promise<CallToolResult> => {
    const output = await gitDiff(ctx.repoPath, args.ref_from, args.ref_to, {
      path: args.path,
    });

    if (!output.trim()) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            repo: ctx.repoName,
            ref_from: args.ref_from,
            ref_to: args.ref_to,
            message: "No differences found",
          }, null, 2),
        }],
      };
    }

    return {
      content: [{ type: "text", text: output }],
    };
  },
};

export const diffOperations = [diffOp];
