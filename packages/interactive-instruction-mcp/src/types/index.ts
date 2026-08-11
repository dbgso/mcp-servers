import type { MarkdownReader } from "../services/markdown-reader.js";

// Re-export shared types from mcp-shared
export type { ReminderConfig, ToolResult, ActionHandler } from "mcp-shared";
import type { ReminderConfig, ActionHandler } from "mcp-shared";

export interface MarkdownSummary {
  id: string;
  description: string;
  whenToUse?: string[];
  relatedDocs?: string[];
}

// Draft workflow status (synced with frontmatter)
export type DraftStatus = "editing" | "self_review" | "user_reviewing" | "pending_approval" | "approved";

export interface DocumentFrontmatter {
  description?: string;
  whenToUse?: string[];
  relatedDocs?: string[];
  status?: DraftStatus;
  selfReviewNotes?: string;
  confirmedAt?: string;
  approvedAt?: string;
}

// Draft tool types
export interface DraftActionParams {
  action?: string;
  id?: string;
  ids?: string;
  content?: string;
  description?: string;
  whenToUse?: string[];
  relatedDocs?: string[];
  newId?: string;
  targetId?: string;
  approvalToken?: string;
  notes?: string;
  confirmed?: boolean;
  force?: boolean;
  status?: DraftStatus;
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
