import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";
import { getTaskPhase } from "./submit-review/base-submit-handler.js";

const confirmSchema = z.object({
  id: z.string().describe("Task ID to confirm"),
  self_review_ref: z
    .string()
    .describe("Self-review doc ID that was re-read before confirming"),
  review_summary: z
    .string()
    .min(50, "Review summary must be at least 50 characters")
    .describe("Summary of what was verified during self-review"),
  evidence: z
    .array(z.string())
    .min(1, "At least one evidence item required")
    .describe("Specific locations verified (file paths, line numbers, etc.)"),
});
type ConfirmArgs = z.infer<typeof confirmSchema>;

/**
 * ConfirmHandler: Confirm self-review is complete and submit for user review
 */
export class ConfirmHandler extends BaseActionHandler<ConfirmArgs, PlanActionContext> {
  readonly action = "confirm";
  readonly schema = confirmSchema;

  readonly help = `# plan confirm

Confirm self-review is complete and submit the task for user review.

## Usage
\`\`\`
plan(action: "confirm", id: "<task-id>",
  self_review_ref: "_mcp-interactive-instruction__plan__self-review__<phase>",
  review_summary: "<what was verified, min 50 chars>",
  evidence: ["<file:line>", "<specific location>", ...])
\`\`\`

## Parameters
- **id** (required): Task ID in self_review status
- **self_review_ref** (required): Self-review doc ID that was re-read (must match task phase)
- **review_summary** (required): Summary of what was verified (min 50 chars)
- **evidence** (required): Array of specific locations verified (file paths, line numbers, etc.)

## Example
\`\`\`
plan(action: "confirm", id: "feature__do",
  self_review_ref: "_mcp-interactive-instruction__plan__self-review__do",
  review_summary: "Verified all code changes include file paths. Design decisions documented. Test plan included with specific commands.",
  evidence: ["src/handler.ts:35-70", "tests/handler.test.ts", "README.md#usage"])
\`\`\`

## Notes
- Only works for tasks in self_review status
- Transitions task from self_review → pending_review
- self_review_ref must match the task's phase (plan/do/check/act)
- This ensures actual self-review was performed before confirming
`;

  protected async doExecute(params: { args: ConfirmArgs; context: PlanActionContext }) {
    const { args, context } = params;
    const { id, self_review_ref, review_summary, evidence } = args;
    const { planReader, planReporter } = context;

    // Get task to check phase
    const task = await planReader.getTask(id);
    if (!task) {
      return {
        content: [{ type: "text" as const, text: `Error: Task "${id}" not found.` }],
        isError: true,
      };
    }

    // Validate self_review_ref matches expected phase
    const taskPhase = getTaskPhase(id);
    if (taskPhase) {
      const expectedRef = `_mcp-interactive-instruction__plan__self-review__${taskPhase}`;
      if (self_review_ref !== expectedRef) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Invalid self_review_ref for ${taskPhase} task.

Expected: "${expectedRef}"
Received: "${self_review_ref}"

You must read the self-review requirements before confirming:
\`help(id: "${expectedRef}")\``,
            },
          ],
          isError: true,
        };
      }
    }

    const result = await planReader.confirmSelfReview(id);

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    await planReporter.updateAll();

    // Re-fetch task to get updated output
    const updatedTask = await planReader.getTask(id);

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${id}" confirmed and submitted for user review.

Status: self_review → pending_review

## Self-Review Summary
${review_summary}

## Evidence Verified
${evidence.map((e) => `- ${e}`).join("\n")}

---

**Waiting for user approval.** User can:
- \`approve(target: "task", task_id: "${id}")\` - Approve and complete
- \`plan(action: "request_changes", id: "${id}", comment: "<feedback>")\` - Request changes

**Output summary:**
${updatedTask?.output || "(no output)"}`,
        },
      ],
    };
  }
}
