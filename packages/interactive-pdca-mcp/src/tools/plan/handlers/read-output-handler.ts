import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";
import { phaseSections, renderSections } from "../../../services/task-presentation.js";

const readOutputSchema = z.object({
  id: z.string().describe("Task ID"),
});
type ReadOutputArgs = z.infer<typeof readOutputSchema>;

/**
 * ReadOutputHandler: Read task_output of a task
 */
export class ReadOutputHandler extends BaseActionHandler<ReadOutputArgs, PlanActionContext> {
  readonly action = "read_output";
  readonly schema = readOutputSchema;

  readonly help = `# plan read_output

Read the task_output (what/why/how) of a task.

## Usage
\`\`\`
plan(action: "read_output", id: "<task-id>")
\`\`\`

## Parameters
- **id** (required): Task ID

## Notes
- Returns the task_output section with what/why/how details
`;

  protected async doExecute(params: { args: ReadOutputArgs; context: PlanActionContext }) {
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

    // Return task_output section
    if (!task.task_output) {
      return {
        content: [
          {
            type: "text" as const,
            text: `# Task Output: ${task.title}\n\n**ID:** ${task.id}\n**Status:** ${task.status}\n\n---\n\n(no task output yet)`,
          },
        ],
      };
    }

    const output = task.task_output;
    const lines = [
      `# Task Output: ${task.title}`,
      "",
      `**ID:** ${task.id}`,
      `**Status:** ${task.status}`,
      `**Phase:** ${output.phase}`,
      "",
      "---",
      "",
      `## What`,
      output.what,
      "",
      `## Why`,
      output.why,
      "",
      `## How`,
      output.how,
    ];

    const sections = phaseSections(output);
    if (sections.length > 0) {
      lines.push("", renderSections({ sections, level: 2 }));
    }

    // Add blockers and risks
    if (output.blockers.length > 0) {
      lines.push("", `## Blockers`);
      for (const blocker of output.blockers) {
        lines.push(`- ${blocker}`);
      }
    }
    if (output.risks.length > 0) {
      lines.push("", `## Risks`);
      for (const risk of output.risks) {
        lines.push(`- ${risk}`);
      }
    }

    // Add references
    lines.push("", `## References Used`, output.references_used.join(", ") || "(none)");
    lines.push("", `## References Reason`, output.references_reason || "(none)");

    return {
      content: [
        {
          type: "text" as const,
          text: lines.join("\n"),
        },
      ],
    };
  }
}
