import type {
  PlanActionContext,
  PlanActionHandler,
  PlanActionParams,
  ToolResult,
} from "../../../types/index.js";
import type { TransitionContext } from "../states/index.js";
import { stateRegistry, VALID_STATUSES } from "../states/index.js";

export class StatusHandler implements PlanActionHandler {
  async execute(params: {
    actionParams: PlanActionParams;
    context: PlanActionContext;
  }): Promise<ToolResult> {
    const { id, status, output, changes, why, references_used, references_reason } =
      params.actionParams;
    const { planReader, planReporter } = params.context;

    // Guard: Required parameters must be provided
    if (!id || !status) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: id and status are required for status action.\nValid statuses: ${VALID_STATUSES.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    // Guard: Status must be a valid TaskStatus enum value
    if (!VALID_STATUSES.includes(status)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Invalid status "${status}".\nValid statuses: ${VALID_STATUSES.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    const task = await planReader.getTask(id);

    // Guard: Task must exist in the plan
    if (!task) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Task "${id}" not found.`,
          },
        ],
        isError: true,
      };
    }

    // Get current state and validate transition
    const currentState = stateRegistry[task.status];
    const { feedbackReader } = params.context;
    const transitionCtx: TransitionContext = {
      task,
      newStatus: status,
      params: params.actionParams,
      planReader,
      feedbackReader,
    };

    const validationResult = await currentState.validateTransition(transitionCtx);

    // Guard: State transition must be allowed by current state
    if (!validationResult.allowed) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${validationResult.error}`,
          },
        ],
        isError: true,
      };
    }

    // Perform the transition
    const oldStatus = task.status;
    const result = await planReader.updateStatus({
      id,
      status,
      output,
      changes,
      why,
      references_used,
      references_reason,
    });

    // Guard: Status update must succeed in plan reader
    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    const actualStatus = result.actualStatus ?? status;

    // Generate additional message from target state
    const additionalInfo = await this.getAdditionalInfo({
      planReader,
      taskId: id,
      actualStatus,
    });

    // Update markdown files
    await planReporter.updateAll();

    const outputInfo = this.formatOutputInfo({ status, output });

    // Add feedback workflow info when rejecting (pending_review -> in_progress)
    const feedbackInfo = this.formatFeedbackInfo({
      oldStatus,
      actualStatus,
      taskId: id,
      feedbackId: validationResult.feedbackId,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${id}" status changed: ${oldStatus} -> ${actualStatus}${outputInfo}${feedbackInfo}${additionalInfo}`,
        },
      ],
    };
  }

  private async getAdditionalInfo(params: {
    planReader: PlanActionContext["planReader"];
    taskId: string;
    actualStatus: string;
  }): Promise<string> {
    const { planReader, taskId, actualStatus } = params;
    const updatedTask = await planReader.getTask(taskId);

    // Guard: Task must still exist after update
    if (!updatedTask) {
      return "";
    }

    return stateRegistry[actualStatus as keyof typeof stateRegistry].getEntryMessage(updatedTask);
  }

  private formatOutputInfo(params: { status: string; output?: string }): string {
    const { status, output } = params;

    // Only show output for completed tasks
    if (status !== "completed") {
      return "";
    }

    // Skip if no output provided
    if (!output) {
      return "";
    }

    return `\nOutput: ${output}`;
  }

  private formatFeedbackInfo(params: {
    oldStatus: string;
    actualStatus: string;
    taskId: string;
    feedbackId?: string;
  }): string {
    const { oldStatus, actualStatus, taskId, feedbackId } = params;

    // Only show feedback info when rejecting (pending_review -> in_progress)
    if (oldStatus !== "pending_review" || actualStatus !== "in_progress") {
      return "";
    }

    // Skip if no feedbackId
    if (!feedbackId) {
      return "";
    }

    return `

---

## 📝 Draft Feedback Created: ${feedbackId}

**Next steps:**
1. AI adds interpretation: \`plan(action: "interpret", id: "${taskId}", feedback_id: "${feedbackId}", interpretation: "<detailed action items>")\`
2. User reviews: \`plan(action: "feedback", id: "${taskId}", feedback_id: "${feedbackId}")\`
3. User confirms: \`approve(target: "feedback", task_id: "${taskId}", feedback_id: "${feedbackId}")\`
4. AI works on the task`;
  }
}
