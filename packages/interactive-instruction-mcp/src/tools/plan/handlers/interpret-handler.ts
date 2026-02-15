import type {
  PlanActionHandler,
  PlanActionParams,
  PlanActionContext,
  ToolResult,
} from "../../../types/index.js";

export class InterpretHandler implements PlanActionHandler {
  async execute(params: {
    actionParams: PlanActionParams;
    context: PlanActionContext;
  }): Promise<ToolResult> {
    const { id, feedback_id, interpretation } = params.actionParams;
    const { feedbackReader } = params.context;

    // Validate required params
    if (!id) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: id (task_id) is required for interpret action.`,
          },
        ],
        isError: true,
      };
    }

    if (!feedback_id) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: feedback_id is required for interpret action.`,
          },
        ],
        isError: true,
      };
    }

    if (!interpretation) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: interpretation is required for interpret action.\n\nProvide a detailed interpretation of what actions you will take to address the feedback.`,
          },
        ],
        isError: true,
      };
    }

    // Get the feedback to validate it exists
    const feedback = await feedbackReader.getFeedback(id, feedback_id);

    if (!feedback) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Feedback "${feedback_id}" not found for task "${id}".`,
          },
        ],
        isError: true,
      };
    }

    // Validate feedback is in draft status
    if (feedback.status !== "draft") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Feedback "${feedback_id}" is already confirmed. Cannot modify interpretation.`,
          },
        ],
        isError: true,
      };
    }

    // Add interpretation
    const result = await feedbackReader.addInterpretation({
      taskId: id,
      feedbackId: feedback_id,
      interpretation,
    });

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Interpretation added to feedback "${feedback_id}".

**Original feedback:**
${feedback.original}

**Your interpretation:**
${interpretation}

---

**Next step:** Present this to the user for approval:
\`approve(target: "feedback", task_id: "${id}", feedback_id: "${feedback_id}", action: "describe")\`

Once user approves, you can proceed with the work.`,
        },
      ],
    };
  }
}
