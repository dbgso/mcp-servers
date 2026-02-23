import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext } from "../../../types/index.js";

const PDCA_PHASES = [
  { suffix: "plan", title: "Plan" },
  { suffix: "do", title: "Do" },
  { suffix: "check", title: "Check" },
  { suffix: "act", title: "Act" },
] as const;

const startSchema = z.object({
  id: z.string().describe("Task ID to start"),
  prompt: z.string().describe("Instructions/request for this task"),
});
type StartArgs = z.infer<typeof startSchema>;

/**
 * StartHandler: pending → in_progress transition
 */
export class StartHandler extends BaseActionHandler<StartArgs, PlanActionContext> {
  readonly action = "start";
  readonly schema = startSchema;

  readonly help = `# plan start

Start a pending task. Creates 4 PDCA subtasks automatically.

## Usage
\`\`\`
plan(action: "start", id: "<task-id>", prompt: "<instructions>")
\`\`\`

## Parameters
- **id** (required): Task ID to start
- **prompt** (required): Instructions/request (saved to prompts/{task-id}.md)

## Notes
- Only pending tasks can be started
- Starting a task creates 4 PDCA subtasks: plan, do, check, act
- Prompt is saved and used as reference during submit
`;

  protected async doExecute(args: StartArgs, context: PlanActionContext) {
    const { id, prompt } = args;
    const { planReader, planReporter, planDir } = context;

    const task = await planReader.getTask(id);
    if (!task) {
      return {
        content: [{ type: "text" as const, text: `Error: Task "${id}" not found.` }],
        isError: true,
      };
    }

    // Allow starting from pending or blocked status
    if (task.status !== "pending" && task.status !== "blocked") {
      return {
        content: [{ type: "text" as const, text: `Error: Cannot start task "${id}". Current status: ${task.status}\n\nOnly pending or blocked tasks can be started.` }],
        isError: true,
      };
    }

    // For subtasks, check that content and completion_criteria are set
    if (task.parent) {
      const missingFields: string[] = [];
      if (!task.content || task.content.trim() === "") {
        missingFields.push("content");
      }
      if (!task.completion_criteria || task.completion_criteria.trim() === "") {
        missingFields.push("completion_criteria");
      }

      if (missingFields.length > 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: Subtask "${id}" must be fleshed out before starting.\n\nMissing: ${missingFields.join(", ")}\n\nUpdate the subtask first:\nplan(action: "update", id: "${id}",\n  content: "<what to do in this phase>",\n  completion_criteria: "<how to know this phase is done>")`,
          }],
          isError: true,
        };
      }
    }

    // Create PDCA subtasks for non-PDCA-phase tasks
    // PDCA phase tasks (ending with __plan, __do, __check, __act) should not get nested PDCA subtasks
    const PDCA_SUFFIXES = ["__plan", "__do", "__check", "__act"];
    const isPdcaPhaseTask = PDCA_SUFFIXES.some((suffix) => id.endsWith(suffix));
    const createdSubtasks: string[] = [];

    if (!isPdcaPhaseTask) {
      let prevSubtaskId: string | null = null;

      for (const phase of PDCA_PHASES) {
        const subtaskId = `${id}__${phase.suffix}`;
        const subtaskDeps = prevSubtaskId ? [prevSubtaskId] : [];
        const subtaskDepReason = prevSubtaskId
          ? `Execute after previous phase completes`
          : "";

        const subtaskResult = await planReader.addTask({
          id: subtaskId,
          title: phase.title,
          content: "",
          parent: id,
          dependencies: subtaskDeps,
          dependency_reason: subtaskDepReason,
          prerequisites: "",
          completion_criteria: "",
          deliverables: [],
          is_parallelizable: false,
          references: [],
        });

        if (subtaskResult.success) {
          createdSubtasks.push(subtaskId);
        }
        prevSubtaskId = subtaskId;
      }
    }

    const result = await planReader.updateStatus({ id, status: "in_progress" });
    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    // Save prompt to prompts/{task-id}.md
    const promptsDir = path.join(planDir, "prompts");
    await fs.mkdir(promptsDir, { recursive: true });
    const promptPath = path.join(promptsDir, `${id}.md`);
    const promptContent = `---
task_id: ${id}
created: ${new Date().toISOString()}
---

# Instructions

${prompt}
`;
    await fs.writeFile(promptPath, promptContent, "utf-8");

    await planReporter.updateAll();

    const promptRef = `prompts/${id}`;

    // Different response for task with PDCA subtasks vs PDCA phase task
    if (!isPdcaPhaseTask) {
      return {
        content: [{
          type: "text" as const,
          text: `Task "${id}" started with 4 PDCA subtasks.

Status: pending → in_progress

**Completion criteria:** ${task.completion_criteria}
**Expected deliverables:** ${task.deliverables.join(", ") || "none"}

## PDCA Subtasks Created
${createdSubtasks.map((s) => `- ${s}`).join("\n")}

**Prompt saved:** ${promptRef}

**Next Step:** Update and start the first subtask:
\`\`\`
plan(action: "update", id: "${id}__plan",
  content: "<what to investigate>",
  completion_criteria: "<how to know planning is done>")

plan(action: "start", id: "${id}__plan", prompt: "<instructions>")
\`\`\``,
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: `Task "${id}" started.

Status: pending → in_progress

**Completion criteria:** ${task.completion_criteria}
**Expected deliverables:** ${task.deliverables.join(", ") || "none"}

**Prompt saved:** ${promptRef}

When done, submit for review with references_used including the prompt:
\`\`\`
plan(action: "submit_*", id: "${id}",
  ...,
  references_used: ["${promptRef}", ...],
  references_reason: "...")
\`\`\``,
      }],
    };
  }
}
