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
  | "completed"
  | "blocked"
  | "skipped";

export interface TaskMetadata {
  id: string;
  title: string;
  status: TaskStatus;
  dependencies: string[];
  dependency_reason: string;
  prerequisites: string;
  completion_criteria: string;
  is_parallelizable: boolean;
  references: string[];
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
  dependencies: string[];
  is_parallelizable: boolean;
}

export interface PlanActionParams {
  id?: string;
  title?: string;
  content?: string;
  dependencies?: string[];
  dependency_reason?: string;
  prerequisites?: string;
  completion_criteria?: string;
  is_parallelizable?: boolean;
  references?: string[];
  status?: TaskStatus;
}

export interface PlanActionContext {
  planReader: PlanReader;
  config: ReminderConfig;
}

export type PlanActionHandler = ActionHandler<PlanActionParams, PlanActionContext>;

// Forward declaration for PlanReader (actual implementation in services)
export interface PlanReader {
  listTasks(): Promise<TaskSummary[]>;
  getTask(id: string): Promise<Task | null>;
  taskExists(id: string): Promise<boolean>;
  addTask(params: {
    id: string;
    title: string;
    content: string;
    dependencies: string[];
    dependency_reason: string;
    prerequisites: string;
    completion_criteria: string;
    is_parallelizable: boolean;
    references: string[];
  }): Promise<{ success: boolean; error?: string; path?: string }>;
  updateTask(params: {
    id: string;
    title?: string;
    content?: string;
    dependencies?: string[];
    dependency_reason?: string;
    prerequisites?: string;
    completion_criteria?: string;
    is_parallelizable?: boolean;
    references?: string[];
  }): Promise<{ success: boolean; error?: string }>;
  updateStatus(params: {
    id: string;
    status: TaskStatus;
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
