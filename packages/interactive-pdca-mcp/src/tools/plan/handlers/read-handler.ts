import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";
import { formatParallel } from "./format-utils.js";

const readSchema = z.object({
  id: z.string().describe("Task ID to read"),
});
type ReadArgs = z.infer<typeof readSchema>;

/**
 * ReadHandler: Read task details
 */
export class ReadHandler extends BaseActionHandler<ReadArgs, PlanActionContext> {
  readonly action = "read";
  readonly schema = readSchema;

  readonly help = `# plan read

Read task details.

## Usage
\`\`\`
plan(action: "read", id: "<task-id>")
\`\`\`

## Parameters
- **id** (required): Task ID to read

## Notes
- Returns all task details including feedback history
`;

  protected async doExecute(args: ReadArgs, context: PlanActionContext) {
    const { id } = args;
    const { planReader } = context;

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

    const deps =
      task.dependencies.length > 0 ? task.dependencies.join(", ") : "none";
    const refs = task.references.length > 0 ? task.references.join(", ") : "none";
    const delivs =
      task.deliverables.length > 0 ? task.deliverables.join(", ") : "none";

    let feedbackSection = "";
    if (task.feedback && task.feedback.length > 0) {
      feedbackSection = "\n\n## Feedback History\n\n";
      for (const fb of task.feedback) {
        const icon = fb.decision === "adopted" ? "✅" : "❌";
        feedbackSection += `${icon} **${fb.decision}** (${fb.timestamp})\n`;
        feedbackSection += `> ${fb.comment}\n\n`;
      }
    }

    const parallelInfo = formatParallel({ task, options: { style: "info" } });

    const output = `# Task: ${task.title}

**ID:** ${task.id}
**Status:** ${task.status}
**Parent:** ${task.parent || "(root)"}
**Dependencies:** ${deps}
**Dependency Reason:** ${task.dependency_reason || "N/A"}
**Prerequisites:** ${task.prerequisites || "N/A"}
**Completion Criteria:** ${task.completion_criteria || "N/A"}
**Deliverables:** ${delivs}
**Output:** ${task.output || "(not completed)"}
**Parallelizable:** ${parallelInfo}
**References:** ${refs}
**Created:** ${task.created}
**Updated:** ${task.updated}

---

${task.content}${feedbackSection}`;

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }
}
