import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";

const deleteSchema = z.object({
  id: z.string().describe("Task ID to delete"),
  force: z.boolean().optional().describe("Force cascade delete (deletes all dependent tasks)"),
  cancel: z.boolean().optional().describe("Cancel a pending deletion"),
});
type DeleteArgs = z.infer<typeof deleteSchema>;

/**
 * DeleteHandler: Remove a task from the plan
 */
export class DeleteHandler extends BaseActionHandler<DeleteArgs, PlanActionContext> {
  readonly action = "delete";
  readonly schema = deleteSchema;

  readonly help = `# plan delete

Delete a task from the plan.

## Usage
\`\`\`
plan(action: "delete", id: "<task-id>")
plan(action: "delete", id: "<task-id>", force: true)  # cascade delete (requires approval)
plan(action: "delete", id: "<task-id>", cancel: true)  # cancel pending deletion
\`\`\`

## Parameters
- **id** (required): Task ID to delete
- **force** (optional): If true, creates pending deletion for all dependent tasks (requires approval)
- **cancel** (optional): If true, cancels a pending deletion

## Notes
- Without force, deletion fails if other tasks depend on this task
- With force: true, creates pending deletion that requires approval via approve tool
- With cancel: true, cancels a pending deletion created by force: true
`;

  protected async doExecute(args: DeleteArgs, context: PlanActionContext) {
    const { id, force, cancel } = args;
    const { planReader, planReporter } = context;

    // Handle cancel pending deletion
    if (cancel) {
      const cancelResult = await planReader.cancelPendingDeletion(id);
      if (!cancelResult.success) {
        return {
          content: [{ type: "text" as const, text: `Error: ${cancelResult.error}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Pending deletion for task "${id}" cancelled.` }],
      };
    }

    const result = await planReader.deleteTask({ id, force });

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    // Update markdown files
    await planReporter.updateAll();

    // Pending deletion requires approval
    if (result.pendingDeletion) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Cascade deletion pending approval.

**${result.pendingDeletion.length} tasks will be deleted:**
${result.pendingDeletion.map(t => `- ${t}`).join("\n")}

To approve, run:
\`\`\`
approve(target: "deletion", task_id: "${id}")
\`\`\``,
          },
        ],
      };
    }

    const deletedList = result.deleted ?? [id];
    if (deletedList.length === 1) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Task "${id}" deleted successfully.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Deleted ${deletedList.length} tasks:\n${deletedList.map(t => `- ${t}`).join("\n")}`,
        },
      ],
    };
  }
}
