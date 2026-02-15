import type { Task, TaskStatus } from "../../../types/index.js";
import type { TaskState, TransitionContext, TransitionResult } from "./types.js";

export class SkippedState implements TaskState {
  readonly status: TaskStatus = "skipped";
  readonly allowedTransitions: TaskStatus[] = ["pending"];

  async validateTransition(ctx: TransitionContext): Promise<TransitionResult> {
    if (this.allowedTransitions.includes(ctx.newStatus)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      error: `Cannot transition from skipped to ${ctx.newStatus}.\n\nTo resume, set to pending:\nplan(action: "status", id: "${ctx.task.id}", status: "pending")`,
    };
  }

  getEntryMessage(_task: Task): string {
    return "";
  }
}
