import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GitOperation, GitOperationContext } from "./types.js";
import { gitLsFiles } from "../git-repo-manager.js";

const lsFilesArgsSchema = z.object({
  repo_url: z.string().optional().describe("Repository URL (omit for current working directory)"),
  ref: z.string().optional().describe('Branch name or commit hash (default: "HEAD")'),
  path: z.string().optional().describe("Directory path to filter"),
  pattern: z.string().optional().describe("Glob pattern to filter (e.g., **/*.ts)"),
});
type LsFilesArgs = z.infer<typeof lsFilesArgsSchema>;

export class LsFilesOp implements GitOperation<LsFilesArgs> {
  readonly id = "ls_files";
  readonly summary = "List files in repository";
  readonly detail = `List files in the repository at specified ref. Filter by path directory or glob pattern.

Examples:
  operation: "ls_files"
  params: { path: "packages/common-lib/src" }
  params: { repo_url: "git@github.com:org/repo.git", ref: "main", pattern: "**/*.ts" }
  params: { path: "src/lib", pattern: "**/*.test.ts" }`;
  readonly category = "File";
  readonly argsSchema = lsFilesArgsSchema;
  async execute(args: LsFilesArgs, ctx: GitOperationContext): Promise<CallToolResult> {
    const ref = args.ref ?? "HEAD";
    const files = await gitLsFiles({
      repoPath: ctx.repoPath,
      ref,
      options: { path: args.path, pattern: args.pattern },
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          repo: ctx.repoName,
          ref,
          total_files: files.length,
          files,
        }, null, 2),
      }],
    };
  }
}

export const lsFilesOp = new LsFilesOp();

export const lsFilesOperations = [lsFilesOp];
