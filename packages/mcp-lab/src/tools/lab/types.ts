import type { ToolResponse } from "mcp-shared";
import type { SessionStore } from "../../session-store.js";

export function textResponse(text: string): ToolResponse {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResponse(text: string): ToolResponse {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export interface LabContext {
  store: SessionStore;
}
