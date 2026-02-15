import type { Task, TaskStatus } from "../../../types/index.js";
import type { TaskState, TransitionContext, TransitionResult } from "./types.js";

export class PendingReviewState implements TaskState {
  readonly status: TaskStatus = "pending_review";
  readonly allowedTransitions: TaskStatus[] = ["in_progress"];

  async validateTransition(ctx: TransitionContext): Promise<TransitionResult> {
    // Check if transition is allowed
    if (!this.allowedTransitions.includes(ctx.newStatus)) {
      return {
        allowed: false,
        error: `Cannot transition from pending_review to ${ctx.newStatus}.\n\nUse approve tool to complete:\napprove(target: "task", task_id: "${ctx.task.id}")\n\nOr reject with feedback:\nplan(action: "status", id: "${ctx.task.id}", status: "in_progress", comment: "<reason>")`,
      };
    }

    // Require feedback comment when rejecting
    if (!ctx.params.comment) {
      return {
        allowed: false,
        error: `Feedback required when rejecting a pending_review task.\n\nProvide comment:\nplan(action: "status", id: "${ctx.task.id}", status: "in_progress", comment: "<rejection reason>")`,
      };
    }

    // Create draft feedback using feedbackReader
    const result = await ctx.feedbackReader.createDraftFeedback({
      taskId: ctx.task.id,
      original: ctx.params.comment,
      decision: "rejected",
    });

    // Check if draft feedback was created successfully
    if (!result.success) {
      return {
        allowed: false,
        error: `Failed to create feedback: ${result.error}`,
      };
    }

    return { allowed: true, feedbackId: result.feedbackId };
  }

  getEntryMessage(task: Task): string {
    return `
---
# 🛑 STOP - REVIEW REQUIRED

Task "${task.id}" is now pending_review. **You MUST stop and wait for user approval.**

## Report to User (Required)

You MUST report the following to the user BEFORE continuing:

### 1. What (具体的な成果物)
- Changed files with line numbers (e.g., \`src/foo.ts:42-58\`)
- Specific code/config changes made
- Deliverables: ${task.deliverables.join(", ") || "(none)"}

### 2. Why (完了条件との対応)
- Completion criteria: ${task.completion_criteria || "(not set)"}
- Explain HOW your implementation satisfies each criterion
- Impact scope: which components/modules are affected

### 3. References (参照したドキュメント)
- List help documents consulted (from \`help()\` tool)
- Task references: ${task.references.join(", ") || "(none)"}
- **Why referenced**: Explain what you learned from each reference
- **If none**: Explain why no references were needed (existing knowledge, simple task, etc.)

## User Actions
- Approve: \`approve(target: "task", task_id: "${task.id}")\`
- Request changes: \`plan(action: "status", id: "${task.id}", status: "in_progress", comment: "<reason>")\`

---`;
  }
}
