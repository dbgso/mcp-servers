import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { BaseActionHandler } from "mcp-shared";
import type { PlanActionContext, PlanReader } from "../../../types/index.js";
import { TASK_PHASES } from "../../../types/index.js";
import { getTaskPhase } from "./submit-review/base-submit-handler.js";
import { listOrNone } from "../../../services/task-presentation.js";

/** Fields a subtask must have filled in before it can start. */
const SUBTASK_REQUIRED_FIELDS = ["content", "completion_criteria"] as const;

/**
 * Add one subtask per PDCA phase under `id`, each depending on the one before.
 * Returns the ids that were created.
 */
async function createPhaseSubtasks(params: { planReader: PlanReader; id: string }): Promise<string[]> {
  const { planReader, id } = params;
  const created: string[] = [];
  let previous: string | null = null;
  for (const phase of TASK_PHASES) {
    const subtaskId = `${id}__${phase}`;
    const result = await planReader.addTask({
      id: subtaskId,
      title: phase.charAt(0).toUpperCase() + phase.slice(1),
      content: "",
      parent: id,
      dependencies: previous ? [previous] : [],
      dependency_reason: previous ? "Execute after previous phase completes" : "",
      prerequisites: "",
      completion_criteria: "",
      deliverables: [],
      is_parallelizable: false,
      references: [],
    });
    if (result.success) created.push(subtaskId);
    previous = subtaskId;
  }
  return created;
}

/** Save the task's instructions to prompts/{task-id}.md, where submit expects to find them. */
async function savePrompt(params: { planDir: string; id: string; prompt: string }): Promise<void> {
  const { planDir, id, prompt } = params;
  const promptsDir = path.join(planDir, "prompts");
  await fs.mkdir(promptsDir, { recursive: true });
  await fs.writeFile(
    path.join(promptsDir, `${id}.md`),
    `---
task_id: ${id}
created: ${new Date().toISOString()}
---

# Instructions

${prompt}
`,
    "utf-8",
  );
}

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

  protected async doExecute(params: { args: StartArgs; context: PlanActionContext }) {
    const { args, context } = params;
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

    // A subtask is started only once it says what to do and when it is done
    const missingFields = task.parent ? SUBTASK_REQUIRED_FIELDS.filter((field) => !task[field].trim()) : [];
    if (missingFields.length > 0) {
      return {
        content: [{
          type: "text" as const,
          text: `Error: Subtask "${id}" must be fleshed out before starting.\n\nMissing: ${missingFields.join(", ")}\n\nUpdate the subtask first:\nplan(action: "update", id: "${id}",\n  content: "<what to do in this phase>",\n  completion_criteria: "<how to know this phase is done>")`,
        }],
        isError: true,
      };
    }

    // A PDCA phase task (x__plan, …) does not get phases of its own
    const isPdcaPhaseTask = getTaskPhase(id) !== null;
    const createdSubtasks = isPdcaPhaseTask ? [] : await createPhaseSubtasks({ planReader, id });

    const result = await planReader.updateStatus({ id, status: "in_progress" });
    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    await savePrompt({ planDir, id, prompt });

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
**Expected deliverables:** ${listOrNone(task.deliverables)}

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
**Expected deliverables:** ${listOrNone(task.deliverables)}

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
