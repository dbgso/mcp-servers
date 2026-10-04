import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorResponse } from "mcp-shared";
import { isGhAvailable } from "../gh-cache.js";

/**
 * The error every GitHub operation returns when gh cannot be used,
 * or null when gh is installed and authenticated.
 */
export async function ghUnavailableResponse(): Promise<CallToolResult | null> {
  if (await isGhAvailable()) return null;
  return errorResponse(
    "gh CLI is not installed or not authenticated. Run `gh auth login` first.",
  );
}
