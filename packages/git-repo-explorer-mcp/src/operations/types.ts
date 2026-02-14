import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface GitOperationContext {
  repoPath: string;
  repoName: string;
}

export interface GitOperation<TArgs = unknown> {
  id: string;
  summary: string;
  detail: string;
  category: string;
  argsSchema: z.ZodType<TArgs>;
  // Method syntax for bivariance (allows assignment to GitOperation<unknown>[])
  execute(args: TArgs, ctx: GitOperationContext): Promise<CallToolResult>;
}
