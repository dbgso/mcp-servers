import type { ReminderConfig, ToolResult } from "mcp-shared";

/**
 * The reminders name the tools this server actually has.
 *
 * They named `help` and `help(id:)` until 2.0.1 -- tools 2.0.0 removed. The
 * release notes said that anything naming the old tools had to be rewritten and
 * this was the one place it was not, which made it the worst place: the block is
 * appended to every response, so it is the most-read text the server emits, and
 * an agent following it calls a tool that does not exist. A name appearing here
 * has to exist, so both are written as calls the registry can answer.
 */
const MCP_REMINDER = `[Reminder] Always refer to this MCP to check for relevant documentation before starting any task. Use \`instruction(action: "list")\` to list available documents.`;

const ORGANIZE_REMINDER = `[Reminder] Review document organization: Use directory hierarchy for related topics. Each file should cover ONE topic only - don't write detailed blocks, instead link to separate topic documents.`;

function buildEveryTaskReminder(params: { docId: string; seconds: number }): string {
  const { docId, seconds } = params;
  return `[Reminder] Information from this MCP is only valid for ${seconds} seconds. After that, it may have been updated. Re-read '${docId}' using \`instruction(action: "read", id: "${docId}")\` to get the latest rules.`;
}

export function buildReminderBlock(params: {
  config: ReminderConfig;
}): string | null {
  const { config } = params;
  const hasReminders =
    config.remindMcp ||
    config.remindOrganize ||
    config.customReminders.length > 0 ||
    config.topicForEveryTask !== null;

  if (!hasReminders) {
    return null;
  }

  const reminders: string[] = [];
  if (config.topicForEveryTask) {
    reminders.push(buildEveryTaskReminder({ docId: config.topicForEveryTask, seconds: config.infoValidSeconds }));
  }
  if (config.remindMcp) {
    reminders.push(MCP_REMINDER);
  }
  if (config.remindOrganize) {
    reminders.push(ORGANIZE_REMINDER);
  }
  for (const customReminder of config.customReminders) {
    reminders.push(`[Reminder] ${customReminder}`);
  }

  return `\n\n---\n\n${reminders.join("\n\n")}`;
}

export function wrapResponse(params: {
  result: ToolResult;
  config: ReminderConfig;
}): ToolResult {
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
