import type { ReminderConfig, ToolResult } from "../types/index.js";

export function buildReminderBlock(params: { config: ReminderConfig }): string {
  const { config } = params;
  const parts: string[] = [];

  if (config.remindMcp) {
    parts.push(
      "<mcp-reminder>Use this MCP tool for git repository operations instead of direct git commands.</mcp-reminder>"
    );
  }

  if (config.remindOrg) {
    parts.push(`<org-reminder>${config.remindOrg}</org-reminder>`);
  }

  if (config.remindTask) {
    parts.push(`<task-reminder>${config.remindTask}</task-reminder>`);
  }

  if (parts.length === 0) {
    return "";
  }

  return "\n\n" + parts.join("\n");
}

export function wrapResponse(params: { result: ToolResult; config: ReminderConfig }): ToolResult {
  const { result, config } = params;
  const reminderBlock = buildReminderBlock({ config });

  if (!reminderBlock) {
    return result;
  }

  return {
    ...result,
    content: result.content.map((item) => ({
      ...item,
      text: item.text + reminderBlock,
    })),
  };
}
