import type { Task, TaskStatus } from "../../../types/index.js";
import type { TaskState, TransitionContext, TransitionResult } from "./types.js";

export class BlockedState implements TaskState {
  readonly status: TaskStatus = "blocked";
  readonly allowedTransitions: TaskStatus[] = ["pending", "in_progress", "skipped"];

  async validateTransition(ctx: TransitionContext): Promise<TransitionResult> {
    if (this.allowedTransitions.includes(ctx.newStatus)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      error: `Cannot transition from blocked to ${ctx.newStatus}.\n\nAllowed: ${this.allowedTransitions.join(", ")}`,
    };
  }

  getEntryMessage(_task: Task): string {
    return "";
  }
}
