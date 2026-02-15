import type { MarkdownReader } from "../services/markdown-reader.js";

export interface MarkdownSummary {
  id: string;
  description: string;
}

export interface ReminderConfig {
  remindMcp: boolean;
  remindOrganize: boolean;
  customReminders: string[];
  topicForEveryTask: string | null;
  infoValidSeconds: number;
}

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export interface ActionHandler<TParams, TContext> {
  execute(params: {
    actionParams: TParams;
    context: TContext;
  }): Promise<ToolResult>;
}

// Draft tool types
export interface DraftActionParams {
  id?: string;
  content?: string;
  newId?: string;
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

// Plan tool types
export type TaskStatus =
  | "pending"
  | "in_progress"
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

// TaskOutput: フェーズ別の成果物報告
// 共通フィールド + フェーズ別フィールドを含む
export interface TaskOutput {
  what: string;        // 何をしたのか
  why: string;         // なぜこれで十分なのか
  how: string;         // どうやって調べた/実装したのか
  blockers: string[];  // 遭遇した障害
  risks: string[];     // リスク・懸念事項
  phase: string;       // research | implement | verify | fix
  // フェーズ別フィールド（オプショナル）
  findings?: string;           // research: 調査結果
  sources?: string[];          // research: 調査ソース
  changes?: FileChange[];      // implement/fix: ファイル変更
  design_decisions?: string;   // implement: 設計判断
  test_target?: string;        // verify: テスト対象
  test_results?: string;       // verify: テスト結果
  coverage?: string;           // verify: 網羅性
  feedback_addressed?: string; // fix: 対応したフィードバック
  references_used: string[];   // 参照したドキュメント（必須）
  references_reason: string;   // 参照理由（必須）
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
export interface PlanActionHandler {
  readonly action: string;
  readonly help: string;
  execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult>;
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
  getFeedback(taskId: string, feedbackId: string): Promise<FeedbackEntry | null>;
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
  config: ReminderConfig;
  planDir: string;
}


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
  addFeedback(params: {
    id: string;
    comment: string;
    decision: FeedbackDecision;
  }): Promise<{ success: boolean; error?: string }>;
  deleteTask(id: string): Promise<{ success: boolean; error?: string }>;
  clearAllTasks(): Promise<{ success: boolean; error?: string; count?: number }>;
  validateDependencies(params: {
    taskId: string;
    dependencies: string[];
  }): Promise<{ valid: boolean; error?: string }>;
  getReadyTasks(): Promise<TaskSummary[]>;
  getBlockedTasks(): Promise<TaskSummary[]>;
  formatTaskList(tasks: TaskSummary[]): string;
}
