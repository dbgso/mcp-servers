import type { MarkdownReader } from "../services/markdown-reader.js";

// Re-export shared types from mcp-shared
export type { ReminderConfig, ToolResult, ActionHandler } from "mcp-shared";
import type { ReminderConfig, ActionHandler } from "mcp-shared";

export interface MarkdownSummary {
  id: string;
  description: string;
}

// Draft tool types
export interface DraftActionParams {
  id?: string;
  content?: string;
  newId?: string;
  targetId?: string;
  approvalToken?: string;
}

export interface DraftActionContext {
  reader: MarkdownReader;
  config: ReminderConfig;
}

export type DraftActionHandler = ActionHandler<DraftActionParams, DraftActionContext>;

// Apply tool types
export interface ApplyActionParams {
  draftId?: string;
  targetId?: string;
}

export interface ApplyActionContext {
  reader: MarkdownReader;
  config: ReminderConfig;
}

export type ApplyActionHandler = ActionHandler<ApplyActionParams, ApplyActionContext>;
