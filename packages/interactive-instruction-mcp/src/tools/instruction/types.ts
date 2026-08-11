import type { ToolResponse } from "mcp-shared";
import type { MarkdownReader } from "../../services/markdown-reader.js";
import type { ReminderConfig } from "../../types/index.js";

/**
 * Build a text ToolResponse.
 */
export function textResponse(text: string): ToolResponse {
  return {
    content: [{ type: "text" as const, text }],
  };
}

/**
 * Build a text ToolResponse marked as an error. Use this when the operation
 * failed so callers can distinguish error responses from successful ones.
 */
export function errorResponse(text: string): ToolResponse {
  return {
    content: [{ type: "text" as const, text }],
    isError: true,
  };
}

/**
 * Context passed to all instruction action handlers.
 */
export interface InstructionContext {
  reader: MarkdownReader;
  config: ReminderConfig;
}

/**
 * Common response helpers for action handlers.
 */
export interface NextActionSuggestion {
  action: string;
  description: string;
  example: string;
}

export function formatNextActions(suggestions: NextActionSuggestion[]): string {
  if (suggestions.length === 0) return "";

  const lines = suggestions.map(
    (s) => `- **${s.action}**: ${s.description}\n  \`${s.example}\``
  );

  return `\n\n---\n\n**Next actions:**\n${lines.join("\n")}`;
}
