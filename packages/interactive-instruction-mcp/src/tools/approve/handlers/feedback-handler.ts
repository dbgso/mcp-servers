import type {
  ToolResult,
  ApproveActionHandler,
  ApproveActionParams,
  ApproveActionContext,
} from "../../../types/index.js";

export class FeedbackHandler implements ApproveActionHandler {
  async execute(params: {
    actionParams: ApproveActionParams;
    context: ApproveActionContext;
  }): Promise<ToolResult> {
    const { task_id, feedback_id } = params.actionParams;
    const { feedbackReader, planReporter } = params.context;

    // Validate task_id is provided
    if (!task_id) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: task_id is required for target "feedback".`,
          },
        ],
        isError: true,
      };
    }

    // Validate feedback_id is provided
    if (!feedback_id) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: feedback_id is required when target is 'feedback'.`,
          },
        ],
        isError: true,
      };
    }

    const feedback = await feedbackReader.getFeedback(task_id, feedback_id);

    // Validate feedback exists
    if (!feedback) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Feedback "${feedback_id}" not found for task "${task_id}".`,
          },
        ],
        isError: true,
      };
    }

    // Validate interpretation exists
    if (!feedback.interpretation) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Feedback "${feedback_id}" has no interpretation.\n\nAI must add interpretation first using:\nplan(action: "interpret", id: "${task_id}", feedback_id: "${feedback_id}", interpretation: "<detailed action items>")`,
          },
        ],
        isError: true,
      };
    }

    const result = await feedbackReader.confirmFeedback({ taskId: task_id, feedbackId: feedback_id });

    // Handle confirmation failure
    if (!result.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${result.error}`,
          },
        ],
        isError: true,
      };
    }

    // Update PENDING_REVIEW.md and GRAPH.md
    await planReporter.updateAll();

    return {
      content: [
        {
          type: "text" as const,
          text: `Feedback "${feedback_id}" confirmed for task "${task_id}".\n\n**Original:** ${feedback.original}\n\n**Interpretation:** ${feedback.interpretation}\n\nAI can now work on addressing this feedback.`,
        },
      ],
    };
  }
}
