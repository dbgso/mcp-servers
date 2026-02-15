import type { Task, TaskStatus } from "../../../types/index.js";
import type { TaskState, TransitionContext, TransitionResult } from "./types.js";
import { SAMPLE_COMPLETE_CALL } from "./sample-complete-call.js";

export class InProgressState implements TaskState {
  readonly status: TaskStatus = "in_progress";
  readonly allowedTransitions: TaskStatus[] = ["completed", "blocked", "skipped"];

  async validateTransition(ctx: TransitionContext): Promise<TransitionResult> {
    if (!this.allowedTransitions.includes(ctx.newStatus)) {
      return {
        allowed: false,
        error: `Cannot transition from in_progress to ${ctx.newStatus}.\n\nAllowed: ${this.allowedTransitions.join(", ")}`,
      };
    }

    if (ctx.newStatus === "completed") {
      return this.validateCompletion(ctx);
    }

    return { allowed: true };
  }

  private validateCompletion(ctx: TransitionContext): TransitionResult {
    const { changes, why, references_used, references_reason } = ctx.params;
    const missingFields: string[] = [];

    if (!changes || changes.length === 0) {
      missingFields.push("changes (array of {file, lines, description})");
    }
    if (!why) {
      missingFields.push("why (explanation of how completion criteria is satisfied)");
    }
    if (references_used === undefined) {
      missingFields.push("references_used (array of doc IDs, or null if none)");
    }
    if (!references_reason) {
      missingFields.push("references_reason (why referenced, or why not needed)");
    }

    if (missingFields.length === 0) {
      return { allowed: true };
    }

    return {
      allowed: false,
      error: `Missing required fields for completing a task:\n${missingFields.map((f) => `- ${f}`).join("\n")}\n\n**Task completion criteria:** ${ctx.task.completion_criteria}\n**Expected deliverables:** ${ctx.task.deliverables.join(", ")}\n\n**Required format:**\n${SAMPLE_COMPLETE_CALL}`,
    };
  }

  getEntryMessage(_task: Task): string {
    return "";
  }
}
