import type { Task, TaskStatus } from "../../../types/index.js";
import type { TaskState, TransitionContext, TransitionResult } from "./types.js";

export class PendingState implements TaskState {
  readonly status: TaskStatus = "pending";
  readonly allowedTransitions: TaskStatus[] = ["in_progress", "skipped"];

  async validateTransition(ctx: TransitionContext): Promise<TransitionResult> {
    if (this.allowedTransitions.includes(ctx.newStatus)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      error: `Cannot transition from pending to ${ctx.newStatus}.\n\nAllowed: ${this.allowedTransitions.join(", ")}\n\nStart the task first:\nplan(action: "status", id: "${ctx.task.id}", status: "in_progress")`,
    };
  }

  getEntryMessage(_task: Task): string {
    return "";
  }
}
