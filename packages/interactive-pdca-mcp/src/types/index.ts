// Re-export shared types
export type { ReminderConfig, ToolResult, ActionHandler } from "mcp-shared";

// Task status types
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "self_review"
  | "pending_review"
  | "completed"
  | "blocked"
  | "skipped";

export type FeedbackDecision = "adopted" | "rejected";
export type FeedbackStatus = "draft" | "confirmed";

// Legacy feedback format (embedded in task)
export interface Feedback {
  comment: string;
  decision: FeedbackDecision;
  timestamp: string;
}

// New feedback format (separate files)
export interface FeedbackEntry {
  id: string;                      // e.g., "fb-001"
  task_id: string;                 // Reference to the task
  original: string;                // User's original feedback text
  interpretation: string | null;   // AI's detailed interpretation (null until interpreted)
  decision: FeedbackDecision;      // adopted/rejected
  status: FeedbackStatus;          // draft/confirmed
  timestamp: string;               // When created
  addressed_by: string | null;     // Reference to completion that addressed this
}

export interface FileChange {
  file: string;
  lines: string;
  description: string;
}

// TaskOutput: Phase-specific output reports
// Contains common fields + phase-specific fields
export interface TaskOutput {
  what: string;        // What was done
  why: string;         // Why this is sufficient
  how: string;         // How it was done/investigated
  blockers: string[];  // Encountered blockers
  risks: string[];     // Risks and concerns
  phase: string;       // plan | do | check | act (PDCA)
  // Phase-specific fields (optional)
  findings?: string;           // plan: Research findings
  sources?: string[];          // plan: Research sources
  changes?: FileChange[];      // do/act: File changes
  design_decisions?: string;   // do: Design decisions
  test_target?: string;        // check: Test target
  test_results?: string;       // check: Test results
  coverage?: string;           // check: Test coverage
  feedback_addressed?: string; // act: Addressed feedback
  references_used: string[];   // Referenced documents (required)
  references_reason: string;   // Reason for references (required)
}

export interface TaskMetadata {
  id: string;
  title: string;
  status: TaskStatus;
  parent: string;
  dependencies: string[];
  dependency_reason: string;
  prerequisites: string;
  completion_criteria: string;
  deliverables: string[];
  output: string;
  task_output: TaskOutput | null;
  is_parallelizable: boolean;
  parallelizable_units?: string[];
  references: string[];
  feedback: Feedback[];
  created: string;
  updated: string;
}

export interface Task extends TaskMetadata {
  content: string;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  parent: string;
  dependencies: string[];
  is_parallelizable: boolean;
  parallelizable_units?: string[];
}

// Base params shared across actions
type BaseParams = {
  id: string;
};

// Action-specific param types
export type StartParams = BaseParams;

export type RequestChangesParams = BaseParams & {
  comment: string;
};

export type SkipParams = BaseParams & {
  reason: string;
};

export type BlockParams = BaseParams & {
  reason: string;
};

export type AddParams = {
  id: string;
  title: string;
  content: string;
  parent?: string;
  dependencies: string[];
  dependency_reason?: string;
  prerequisites: string;
  completion_criteria: string;
  deliverables: string[];
  is_parallelizable: boolean;
  parallelizable_units?: string[];
  references: string[];
};

export type UpdateParams = BaseParams & {
  title?: string;
  content?: string;
  dependencies?: string[];
  dependency_reason?: string;
  prerequisites?: string;
  completion_criteria?: string;
  is_parallelizable?: boolean;
  parallelizable_units?: string[];
  references?: string[];
};

export type InterpretParams = BaseParams & {
  feedback_id: string;
  interpretation: string;
};

export type FeedbackParams = BaseParams & {
  comment: string;
  decision: FeedbackDecision;
};

// Raw params passed from tool input to handlers
// Each handler validates its own fields with Zod
export type PlanRawParams = Record<string, unknown>;

// Handler interface for plan actions
// Compatible with RegistrableActionHandler from mcp-shared
export interface PlanActionHandler {
  readonly action: string;
  readonly help: string;
  execute(rawParams: unknown, context: PlanActionContext): Promise<import("mcp-shared").ToolResult>;
}

// Legacy: Used by state machine (TransitionContext) for status transitions
export type PlanActionParams = PlanRawParams;


export interface PlanReporter {
  updatePendingReviewFile(): Promise<void>;
  updateGraphFile(): Promise<void>;
  updateAll(): Promise<void>;
}

export interface FeedbackReaderInterface {
  createDraftFeedback(params: {
    taskId: string;
    original: string;
    decision: FeedbackDecision;
  }): Promise<{ success: boolean; error?: string; feedbackId?: string }>;
  getFeedback({ taskId, feedbackId }: { taskId: string; feedbackId: string }): Promise<FeedbackEntry | null>;
  listFeedback(taskId: string): Promise<FeedbackEntry[]>;
  getUnaddressedFeedback(taskId: string): Promise<FeedbackEntry[]>;
  getDraftFeedback(taskId: string): Promise<FeedbackEntry[]>;
  addInterpretation(params: {
    taskId: string;
    feedbackId: string;
    interpretation: string;
  }): Promise<{ success: boolean; error?: string }>;
  confirmFeedback(params: {
    taskId: string;
    feedbackId: string;
  }): Promise<{ success: boolean; error?: string }>;
  markAsAddressed(params: {
    taskId: string;
    feedbackId: string;
    addressedBy: string;
  }): Promise<{ success: boolean; error?: string }>;
}

export interface PlanActionContext {
  planReader: PlanReader;
  planReporter: PlanReporter;
  feedbackReader: FeedbackReaderInterface;
  config: import("mcp-shared").ReminderConfig;
  planDir: string;
}

// Approve tool types
export interface ApproveActionParams {
  task_id?: string;
  feedback_id?: string;
  reason?: string;
  approvalToken?: string;
}

export interface ApproveActionContext {
  planReader: PlanReader;
  planReporter: PlanReporter;
  feedbackReader: FeedbackReaderInterface;
  markdownDir: string;
  planDir: string;
  config: import("mcp-shared").ReminderConfig;
}

export type ApproveActionHandler = import("mcp-shared").ActionHandler<ApproveActionParams, ApproveActionContext>;

// Forward declaration for PlanReader (actual implementation in services)
export interface PlanReader {
  listTasks(): Promise<TaskSummary[]>;
  getTask(id: string): Promise<Task | null>;
  taskExists(id: string): Promise<boolean>;
  addTask(params: {
    id: string;
    title: string;
    content: string;
    parent: string;
    dependencies: string[];
    dependency_reason: string;
    prerequisites: string;
    completion_criteria: string;
    deliverables: string[];
    is_parallelizable: boolean;
    parallelizable_units?: string[];
    references: string[];
  }): Promise<{ success: boolean; error?: string; path?: string }>;
  getChildTasks(parentId: string): Promise<TaskSummary[]>;
  updateTask(params: {
    id: string;
    title?: string;
    content?: string;
    dependencies?: string[];
    dependency_reason?: string;
    prerequisites?: string;
    completion_criteria?: string;
    is_parallelizable?: boolean;
    parallelizable_units?: string[];
    references?: string[];
  }): Promise<{ success: boolean; error?: string }>;
  updateStatus(params: {
    id: string;
    status: TaskStatus;
    output?: string;
    task_output?: TaskOutput;
  }): Promise<{ success: boolean; error?: string; actualStatus?: TaskStatus }>;
  approveTask(id: string): Promise<{ success: boolean; error?: string }>;
  confirmSelfReview(id: string): Promise<{ success: boolean; error?: string }>;
  addFeedback(params: {
    id: string;
    comment: string;
    decision: FeedbackDecision;
  }): Promise<{ success: boolean; error?: string }>;
  deleteTask(params: {
    id: string;
    force?: boolean;
  }): Promise<{ success: boolean; error?: string; deleted?: string[]; pendingDeletion?: string[] }>;
  getPendingDeletion(taskId: string): Promise<{ taskId: string; targets: string[] } | null>;
  executePendingDeletion(taskId: string): Promise<{ success: boolean; error?: string; deleted?: string[] }>;
  cancelPendingDeletion(taskId: string): Promise<{ success: boolean; error?: string }>;
  clearAllTasks(): Promise<{ success: boolean; error?: string; count?: number }>;
  validateDependencies(params: {
    taskId: string;
    dependencies: string[];
  }): Promise<{ valid: boolean; error?: string }>;
  getReadyTasks(): Promise<TaskSummary[]>;
  getBlockedTasks(): Promise<TaskSummary[]>;
  formatTaskList(tasks: TaskSummary[]): string;
}
