import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * One operation `exec` can run, chosen by its `op` argument.
 *
 * The tool says what kind of call it is and `op` says what the call does
 * (`policy__mcp-tool-surface`), so adding an operation is adding one of these,
 * not a tool.
 */
export interface Op {
  /** The value of `op` that selects this operation. */
  readonly name: string;
  /** Run it with the raw arguments `exec` received, `op` included. */
  execute(args: Record<string, unknown>): Promise<CallToolResult>;
}
