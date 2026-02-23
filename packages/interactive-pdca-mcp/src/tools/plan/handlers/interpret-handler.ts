import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";

const interpretSchema = z.object({
  id: z.string().describe("Task ID"),
  feedback_id: z.string().describe("Feedback ID"),
  interpretation: z.string().describe("AI interpretation of feedback"),
});
type InterpretArgs = z.infer<typeof interpretSchema>;

/**
 * InterpretHandler: Add interpretation to feedback
 */
export class InterpretHandler extends BaseActionHandler<InterpretArgs, PlanActionContext> {
  readonly action = "interpret";
  readonly schema = interpretSchema;

  readonly help = `# plan interpret

Add your interpretation of user feedback.

## Usage
\`\`\`
plan(action: "interpret", id: "<task-id>", feedback_id: "<feedback-id>", interpretation: "<your-interpretation>")
\`\`\`

## Parameters
- **id** (required): Task ID
- **feedback_id** (required): Feedback ID
- **interpretation** (required): AI interpretation of feedback

## Notes
- Feedback must be in draft status
- Provide a detailed interpretation of what actions you will take to address the feedback
- After interpretation, present to user for approval
`;

  protected async doExecute(args: InterpretArgs, context: PlanActionContext) {
    const { id, feedback_id, interpretation } = args;
    const { feedbackReader } = context;

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

    // Update PENDING_REVIEW.md to include this feedback
    const { planReporter } = context;
    await planReporter.updateAll();

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
