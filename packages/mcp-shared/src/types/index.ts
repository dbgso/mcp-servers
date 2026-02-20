/**
 * Configuration for reminder messages appended to MCP tool responses
 */
export interface ReminderConfig {
  remindMcp: boolean;
  remindOrganize: boolean;
  customReminders: string[];
  topicForEveryTask: string | null;
  infoValidSeconds: number;
}

/**
 * Standard MCP tool result format
 */
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Generic action handler interface for MCP tools
 */
export interface ActionHandler<TParams, TContext> {
  execute(params: {
    actionParams: TParams;
    context: TContext;
  }): Promise<ToolResult>;
}
