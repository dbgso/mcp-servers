import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GitOperation, GitOperationContext } from "./types.js";
import { gitTagList } from "../git-repo-manager.js";

const tagListArgsSchema = z.object({
  repo_url: z.string().optional().describe("Repository URL (omit for current working directory)"),
  pattern: z.string().optional().describe("Filter pattern (e.g., v2.*)"),
  max_count: z.number().int().min(1).max(500).optional().describe("Maximum tags to show (default: all)"),
});
type TagListArgs = z.infer<typeof tagListArgsSchema>;

export class TagListOp implements GitOperation<TagListArgs> {
  readonly id = "tag_list";
  readonly summary = "List tags (newest first)";
  readonly detail = `List tags in the repository, sorted by newest first. Filter by pattern or limit count.

Examples:
  operation: "tag_list"
  params: {}
  params: { repo_url: "git@github.com:org/repo.git", pattern: "v2.*" }
  params: { max_count: 10 }`;
  readonly category = "Reference";
  readonly argsSchema = tagListArgsSchema;
  async execute(args: TagListArgs, ctx: GitOperationContext): Promise<CallToolResult> {
    const tags = await gitTagList({
      repoPath: ctx.repoPath,
      options: { pattern: args.pattern, max_count: args.max_count },
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          repo: ctx.repoName,
          total: tags.length,
          tags,
        }, null, 2),
      }],
    };
  }
}

export const tagListOp = new TagListOp();

export const tagOperations = [tagListOp];
