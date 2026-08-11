import type { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Operation definition
 */
export interface Operation<TArgs = unknown> {
  id: string;
  summary: string;
  detail: string;
  argsSchema: z.ZodType<TArgs>;
  execute: (args: TArgs) => Promise<CallToolResult>;
}
