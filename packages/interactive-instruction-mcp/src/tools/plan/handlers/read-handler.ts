import { z } from "zod";
import type {
  PlanActionContext,
  ToolResult,
  PlanRawParams,
  Task,
} from "../../../types/index.js";

const paramsSchema = z.object({
  id: z.string().describe("Task ID to read"),
});

/**
 * Format parallelizable info for task display.
 */
function formatParallelInfo(task: Task): string {
  if (!task.is_parallelizable) {
    return "no";
  }
  if (task.parallelizable_units && task.parallelizable_units.length > 0) {
    return `yes (units: ${task.parallelizable_units.join(", ")})`;
  }
  return "yes";
}

/**
 * ReadHandler: Read task details
 */
export class ReadHandler {
  readonly action = "read";

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

  async execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult> {
    const parseResult = paramsSchema.safeParse(params.rawParams);
    if (!parseResult.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${parseResult.error.errors.map(e => e.message).join(", ")}\n\n${this.help}` }],
        isError: true,
      };
    }

    const { id } = parseResult.data;
    const { planReader } = params.context;

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

    const parallelInfo = formatParallelInfo(task);

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
