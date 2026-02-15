import type { Task, TaskStatus, PlanActionParams, PlanReader, FeedbackReaderInterface } from "../../../types/index.js";

export interface TransitionContext {
  task: Task;
  newStatus: TaskStatus;
  params: PlanActionParams;
  planReader: PlanReader;
  feedbackReader: FeedbackReaderInterface;
}

export interface TransitionResult {
  allowed: boolean;
  error?: string;
  feedbackId?: string;
}

export interface TaskState {
  readonly status: TaskStatus;
  readonly allowedTransitions: TaskStatus[];
  validateTransition(ctx: TransitionContext): Promise<TransitionResult>;
  getEntryMessage(task: Task): string;
}
