import type {
  PlanActionHandler,
  PlanActionParams,
  PlanActionContext,
  ToolResult,
  FeedbackEntry,
} from "../../../types/index.js";

export class FeedbackHandler implements PlanActionHandler {
  async execute(params: {
    actionParams: PlanActionParams;
    context: PlanActionContext;
  }): Promise<ToolResult> {
    const { id, feedback_id } = params.actionParams;
    const { feedbackReader, planReader } = params.context;

    // Validate task id is provided
    if (!id) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: id (task_id) is required for feedback action.

Usage:
  plan(action: "feedback", id: "<task-id>")                         → List all feedback for task
  plan(action: "feedback", id: "<task-id>", feedback_id: "<fb-id>")  → Show specific feedback`,
          },
        ],
        isError: true,
      };
    }

    // Validate task exists
    const task = await planReader.getTask(id);
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

    // Show specific feedback if feedback_id is provided
    if (feedback_id) {
      return this.showFeedback({ taskId: id, feedbackId: feedback_id, feedbackReader });
    }

    // List all feedback for the task
    return this.listFeedback({ taskId: id, taskTitle: task.title, feedbackReader });
  }

  private async listFeedback(params: {
    taskId: string;
    taskTitle: string;
    feedbackReader: PlanActionContext["feedbackReader"];
  }): Promise<ToolResult> {
    const { taskId, taskTitle, feedbackReader } = params;
    const allFeedback = await feedbackReader.listFeedback(taskId);

    if (allFeedback.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No feedback found for task "${taskId}".`,
          },
        ],
      };
    }

    const draftFeedback = allFeedback.filter((fb) => fb.status === "draft");
    const confirmedFeedback = allFeedback.filter((fb) => fb.status === "confirmed");
    const addressedFeedback = confirmedFeedback.filter((fb) => fb.addressed_by !== null);
    const unaddressedFeedback = confirmedFeedback.filter((fb) => fb.addressed_by === null);

    let output = `# Feedback for: ${taskTitle}

**Task ID:** ${taskId}
**Total:** ${allFeedback.length} | Draft: ${draftFeedback.length} | Confirmed: ${confirmedFeedback.length} | Addressed: ${addressedFeedback.length}

`;

    // Draft feedback (needs interpretation)
    if (draftFeedback.length > 0) {
      output += `## 📝 Draft (needs interpretation)\n\n`;
      for (const fb of draftFeedback) {
        output += this.formatFeedbackSummary({ fb, taskId });
      }
    }

    // Unaddressed feedback (confirmed but not yet addressed)
    if (unaddressedFeedback.length > 0) {
      output += `## ⚠️ Unaddressed (confirmed, needs work)\n\n`;
      for (const fb of unaddressedFeedback) {
        output += this.formatFeedbackSummary({ fb, taskId });
      }
    }

    // Addressed feedback
    if (addressedFeedback.length > 0) {
      output += `## ✅ Addressed\n\n`;
      for (const fb of addressedFeedback) {
        output += this.formatFeedbackSummary({ fb, taskId });
      }
    }

    return {
      content: [{ type: "text" as const, text: output.trim() }],
    };
  }

  private formatFeedbackSummary(params: { fb: FeedbackEntry; taskId: string }): string {
    const { fb, taskId } = params;
    const hasInterpretation = fb.interpretation ? "✓" : "✗";
    const truncatedOriginal = fb.original.length > 80
      ? fb.original.slice(0, 80) + "..."
      : fb.original;

    return `- **${fb.id}** [${fb.status}] interpretation: ${hasInterpretation}
  > ${truncatedOriginal}
  \`plan(action: "feedback", id: "${taskId}", feedback_id: "${fb.id}")\`

`;
  }

  private async showFeedback(params: {
    taskId: string;
    feedbackId: string;
    feedbackReader: PlanActionContext["feedbackReader"];
  }): Promise<ToolResult> {
    const { taskId, feedbackId, feedbackReader } = params;
    const feedback = await feedbackReader.getFeedback(taskId, feedbackId);

    if (!feedback) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Feedback "${feedbackId}" not found for task "${taskId}".`,
          },
        ],
        isError: true,
      };
    }

    const statusBadge = feedback.status === "draft" ? "📝 DRAFT" : "✅ CONFIRMED";
    const addressedInfo = feedback.addressed_by
      ? `\n**Addressed by:** ${feedback.addressed_by}`
      : "";

    const interpretationSection = feedback.interpretation
      ? `## AI Interpretation\n\n${feedback.interpretation}`
      : "_No interpretation yet. AI needs to add interpretation before approval._\n\n**Next step:** \`plan(action: \"interpret\", id: \"${taskId}\", feedback_id: \"${feedbackId}\", interpretation: \"<detailed action items>\")\`";

    const approvalSection = feedback.status === "draft" && feedback.interpretation
      ? `\n---\n\n**Ready for approval:** \`approve(target: "feedback", task_id: "${taskId}", feedback_id: "${feedbackId}")\``
      : "";

    const output = `# Feedback: ${feedbackId}

**Status:** ${statusBadge}
**Task:** ${taskId}
**Decision:** ${feedback.decision}
**Created:** ${feedback.timestamp}${addressedInfo}

---

## Original Feedback (User)

${feedback.original}

---

${interpretationSection}${approvalSection}`;

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }
}
