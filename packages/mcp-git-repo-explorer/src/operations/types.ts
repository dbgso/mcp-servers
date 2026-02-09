import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface GitOperationContext {
  repoPath: string;
  repoName: string;
}

export interface GitOperation<TArgs = any> {
  id: string;
  summary: string;
  detail: string;
  category: string;
  argsSchema: z.ZodType<TArgs>;
  execute: (args: TArgs, ctx: GitOperationContext) => Promise<CallToolResult>;
}
