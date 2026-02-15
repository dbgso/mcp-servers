import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type {
  PlanActionContext,
  ToolResult,
  PlanRawParams,
} from "../../../types/index.js";

const paramsSchema = z.object({
  id: z.string().describe("Task ID to start"),
  prompt: z.string().describe("依頼内容・指示（必須）"),
});

/**
 * StartHandler: pending → in_progress transition
 */
export class StartHandler {
  readonly action = "start";

  readonly help = `# plan start

Start a pending task.

## Usage
\`\`\`
plan(action: "start", id: "<task-id>", prompt: "<依頼内容>")
\`\`\`

## Parameters
- **id** (required): Task ID to start
- **prompt** (required): 依頼内容・指示（prompts/{task-id}.mdに保存される）

## Notes
- Only pending tasks can be started
- Subtasks must have content and completion_criteria set before starting
- promptは参照可能なファイルとして保存され、submit時にreferencesとして使用
`;

  async execute(params: { rawParams: PlanRawParams; context: PlanActionContext }): Promise<ToolResult> {
    const parseResult = paramsSchema.safeParse(params.rawParams);
    if (!parseResult.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${parseResult.error.errors.map(e => e.message).join(", ")}\n\n${this.help}` }],
        isError: true,
      };
    }
    const { id, prompt } = parseResult.data;
    const { planReader, planReporter, planDir } = params.context;

    const task = await planReader.getTask(id);
    if (!task) {
      return {
        content: [{ type: "text" as const, text: `Error: Task "${id}" not found.` }],
        isError: true,
      };
    }

    if (task.status !== "pending") {
      return {
        content: [{ type: "text" as const, text: `Error: Cannot start task "${id}". Current status: ${task.status}\n\nOnly pending tasks can be started.` }],
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

# 依頼内容

${prompt}
`;
    await fs.writeFile(promptPath, promptContent, "utf-8");

    await planReporter.updateAll();

    const promptRef = `prompts/${id}`;
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
