import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolResponse } from "mcp-shared";
import type { SessionStore } from "../../session-store.js";

export function textResponse(text: string): ToolResponse {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResponse(text: string): ToolResponse {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** A session's tools, one `- **name** — description` line each. */
export function toolListLines(tools: Pick<Tool, "name" | "description">[]): string[] {
  return tools.map((tool) => `- **${tool.name}** — ${tool.description ?? ""}`);
}

export interface LabContext {
  store: SessionStore;
}
