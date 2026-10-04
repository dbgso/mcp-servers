import type { ToolResponse } from "mcp-shared";
import { allOperations } from "../../operations/registry.js";

/** The error git_describe and git_execute return for an operation ID that does not exist. */
export function unknownOperationResponse(operation: string): ToolResponse {
  const available = allOperations.map(o => o.id).join(", ");
  return {
    content: [{ type: "text", text: `Unknown operation: "${operation}"\n\nAvailable operations: ${available}` }],
    isError: true,
  };
}
