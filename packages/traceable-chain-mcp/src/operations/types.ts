import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ChainManager } from "../chain-manager.js";

export interface OperationContext {
  manager: ChainManager;
}

export interface Operation<TArgs = unknown> {
  id: string;
  summary: string;
  detail: string;
  argsSchema: z.ZodType<TArgs>;
  // Method syntax for bivariance (allows assignment to Operation<unknown>[])
  execute(args: TArgs, ctx: OperationContext): Promise<CallToolResult>;
}
