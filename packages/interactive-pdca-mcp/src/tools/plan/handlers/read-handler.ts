import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext, Task } from "../../../types/index.js";
import { listOrNone } from "../../../services/task-presentation.js";
import { formatParallel } from "./format-utils.js";

const readSchema = z.object({
  id: z.string().describe("Task ID to read"),
});
type ReadArgs = z.infer<typeof readSchema>;

/**
 * The task's feedback as a "Feedback History" section, or "" when it has none.
 * The leading blank lines separate it from the task body it is appended to.
 */
export function formatFeedbackHistory(feedback: Task["feedback"]): string {
  if (!feedback || feedback.length === 0) {
    return "";
  }
  const entries = feedback.map((fb) => {
    const icon = fb.decision === "adopted" ? "✅" : "❌";
    return `${icon} **${fb.decision}** (${fb.timestamp})\n> ${fb.comment}\n\n`;
  });
  return `\n\n## Feedback History\n\n${entries.join("")}`;
}

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

  protected async doExecute(params: { args: ReadArgs; context: PlanActionContext }) {
    const { args, context } = params;
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

    const feedbackSection = formatFeedbackHistory(task.feedback);
    const parallelInfo = formatParallel({ task, options: { style: "info" } });

    const output = `# Task: ${task.title}

**ID:** ${task.id}
**Status:** ${task.status}
**Parent:** ${task.parent || "(root)"}
**Dependencies:** ${listOrNone(task.dependencies)}
**Dependency Reason:** ${task.dependency_reason || "N/A"}
**Prerequisites:** ${task.prerequisites || "N/A"}
**Completion Criteria:** ${task.completion_criteria || "N/A"}
**Deliverables:** ${listOrNone(task.deliverables)}
**Output:** ${task.output || "(not completed)"}
**Parallelizable:** ${parallelInfo}
**References:** ${listOrNone(task.references)}
**Created:** ${task.created}
**Updated:** ${task.updated}

---

${task.content}${feedbackSection}`;

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }
}
