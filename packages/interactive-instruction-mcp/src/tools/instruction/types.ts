import type { ToolResponse } from "mcp-shared";
import type { MarkdownReader } from "../../services/markdown-reader.js";
import type { ReminderConfig } from "../../types/index.js";
import type { InstructionAction } from "./registry.js";

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
 * One suggested next call.
 *
 * The action and the example are tied together by type: each member of this
 * union fixes `example` to a template that names that action. So an example
 * cannot suggest an action nobody registered, and cannot disagree with the
 * `action` beside it -- both were free-form strings, and a rename left it to a
 * search-and-replace to keep nine occurrences across five files in step.
 */
export type NextActionSuggestion = {
  [A in InstructionAction]: {
    action: A;
    description: string;
    example: `instruction(action: "${A}"${string})`;
  };
}[InstructionAction];

export function formatNextActions(suggestions: NextActionSuggestion[]): string {
  if (suggestions.length === 0) return "";

  const lines = suggestions.map(
    (s) => `- **${s.action}**: ${s.description}\n  \`${s.example}\``
  );

  return `\n\n---\n\n**Next actions:**\n${lines.join("\n")}`;
}
