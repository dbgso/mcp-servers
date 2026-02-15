import type { Task, TaskStatus } from "../../../types/index.js";
import type { TaskState, TransitionContext, TransitionResult } from "./types.js";

export class CompletedState implements TaskState {
  readonly status: TaskStatus = "completed";
  readonly allowedTransitions: TaskStatus[] = [];

  async validateTransition(ctx: TransitionContext): Promise<TransitionResult> {
    return {
      allowed: false,
      error: `Cannot change status of completed task "${ctx.task.id}".\n\nCompleted tasks are immutable.`,
    };
  }

  getEntryMessage(_task: Task): string {
    return "";
  }
}
