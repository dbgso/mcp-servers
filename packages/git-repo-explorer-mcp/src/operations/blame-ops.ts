import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GitOperation } from "./types.js";
import { gitBlame } from "../git-repo-manager.js";

interface BlameLine {
  commit: string;
  author: string;
  date: string;
  line_number: number;
  content: string;
}

function parseBlameOutput(output: string): BlameLine[] {
  if (!output.trim()) return [];

  const lines = output.split("\n");
  const result: BlameLine[] = [];
  let currentCommit = "";
  let currentAuthor = "";
  let currentDate = "";
  let currentLineNum = 0;

  for (const line of lines) {
    // Commit header line: <sha> <orig-line> <final-line> [<num-lines>]
    const commitMatch = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (commitMatch) {
      currentCommit = commitMatch[1]!;
      currentLineNum = Number.parseInt(commitMatch[2]!, 10);
      continue;
    }

    if (line.startsWith("author ")) {
      currentAuthor = line.slice("author ".length);
    } else if (line.startsWith("author-time ")) {
      const timestamp = Number.parseInt(line.slice("author-time ".length), 10);
      currentDate = new Date(timestamp * 1000).toISOString().slice(0, 10);
    } else if (line.startsWith("\t")) {
      // Content line (starts with tab)
      result.push({
        commit: currentCommit.slice(0, 8),
        author: currentAuthor,
        date: currentDate,
        line_number: currentLineNum,
        content: line.slice(1), // Remove leading tab
      });
    }
  }

  return result;
}

export const blameOp: GitOperation = {
  id: "blame",
  summary: "Show line-by-line author and commit info",
  detail: `Show git blame information for each line in a file. Optionally specify line range.

Examples:
  operation: "blame"
  params: { path: "src/lib/mcp/index.ts" }
  params: { repo_url: "git@github.com:org/repo.git", ref: "main", path: "packages/api/src/handler.ts", line_start: 10, line_end: 30 }`,
  category: "History",
  argsSchema: z.object({
    repo_url: z.string().optional().describe("Repository URL (omit for current working directory)"),
    ref: z.string().optional().describe('Branch name or commit hash (default: "HEAD")'),
    path: z.string().describe("Target file path (required)"),
    line_start: z.number().int().min(1).optional().describe("Start line number"),
    line_end: z.number().int().min(1).optional().describe("End line number"),
  }),
  execute: async (args, ctx): Promise<CallToolResult> => {
    const ref = args.ref ?? "HEAD";
    const output = await gitBlame(ctx.repoPath, ref, args.path, {
      line_start: args.line_start,
      line_end: args.line_end,
    });

    const blameLines = parseBlameOutput(output);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          repo: ctx.repoName,
          ref,
          path: args.path,
          total_lines: blameLines.length,
          lines: blameLines,
        }, null, 2),
      }],
    };
  },
};

export const blameOperations: GitOperation[] = [blameOp];
