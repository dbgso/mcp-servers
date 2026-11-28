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
  /**
   * Why this document is deliberately longer than the size check allows.
   *
   * A reason rather than a flag: the point is that the next reader can tell a
   * considered exception from a warning nobody got to.
   */
  sizeExemption?: string;
  confirmedAt?: string;
  approvedAt?: string;
}

// Draft tool types

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
