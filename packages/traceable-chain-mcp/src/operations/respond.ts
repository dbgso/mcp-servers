import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getErrorMessage } from "mcp-shared";

/** Run `body` and return its value as pretty JSON, or its error as an error result */
export async function respondJson(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await body();
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { content: [{ type: "text", text: getErrorMessage(error) }], isError: true };
  }
}
