import { z } from "zod";
import type {
  PlanActionContext,
  ToolResult,
  PlanRawParams,
  PlanActionHandler,
} from "../../../../types/index.js";

/**
 * Base schema for all submit_review actions
 * Common required fields across all task types
 */
export const baseParamsSchema = z.object({
  id: z.string(),
  output_what: z.string().describe("何をしたのか"),
  output_why: z.string().describe("なぜこれで十分なのか"),
  output_how: z.string().describe("どうやって調べた/実装したのか"),
  blockers: z.array(z.string()).describe("遭遇した障害・ブロッカー（空配列可）"),
  risks: z.array(z.string()).describe("リスク・懸念事項（空配列可）"),
  references_used: z.array(z.string()).min(1).describe("参照したドキュメント（必須、prompts/{task-id}を含む）"),
  references_reason: z.string().describe("参照した理由・どのように活用したか"),
});

export type BaseSubmitParams = z.infer<typeof baseParamsSchema>;

/**
 * Task phase suffixes
 */
export const TASK_PHASES = ["research", "implement", "verify", "fix"] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];

/**
 * Extract task phase from task ID
 * e.g., "feature-x__research" -> "research"
 */
export function getTaskPhase(taskId: string): TaskPhase | null {
  for (const phase of TASK_PHASES) {
    if (taskId.endsWith(`__${phase}`)) {
      return phase;
    }
  }
  return null;
}

/**
 * Abstract base class for submit review handlers
 */
export abstract class BaseSubmitHandler implements PlanActionHandler {
  abstract readonly action: string;
  abstract readonly help: string;
  abstract readonly phase: TaskPhase;

  /**
   * Validate phase-specific fields
   * @returns Error message if validation fails, null if valid
   */
  protected abstract validatePhaseFields(params: {
    rawParams: PlanRawParams;
  }): string | null;

  /**
   * Get phase-specific data for storage
   */
  protected abstract getPhaseData(params: {
    rawParams: PlanRawParams;
  }): Record<string, unknown>;

  /**
   * Format phase-specific output for response
   */
  protected abstract formatPhaseOutput(params: {
    rawParams: PlanRawParams;
  }): string;

  async execute(params: {
    rawParams: PlanRawParams;
    context: PlanActionContext;
  }): Promise<ToolResult> {
    // Validate base params
    const baseResult = baseParamsSchema.safeParse(params.rawParams);
    if (!baseResult.success) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${baseResult.error.errors.map((e) => e.message).join(", ")}\n\n${this.help}`,
          },
        ],
        isError: true,
      };
    }

    // Validate phase-specific fields
    const phaseError = this.validatePhaseFields(params);
    if (phaseError) {
      return {
        content: [{ type: "text" as const, text: `Error: ${phaseError}\n\n${this.help}` }],
        isError: true,
      };
    }

    const { id, output_what, output_why, output_how, blockers, risks, references_used, references_reason } =
      baseResult.data;
    const { planReader, planReporter } = params.context;

    const task = await planReader.getTask(id);
    if (!task) {
      return {
        content: [{ type: "text" as const, text: `Error: Task "${id}" not found.` }],
        isError: true,
      };
    }

    // Check current status
    if (task.status !== "in_progress") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Cannot submit for review. Task "${id}" status: ${task.status}\n\nOnly in_progress tasks can be submitted for review.`,
          },
        ],
        isError: true,
      };
    }

    // Validate task phase matches handler
    const taskPhase = getTaskPhase(id);
    if (taskPhase && taskPhase !== this.phase) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Task "${id}" is a ${taskPhase} task. Use submit_${taskPhase} instead of submit_${this.phase}.`,
          },
        ],
        isError: true,
      };
    }

    // Build task_output with phase-specific data
    const phaseData = this.getPhaseData(params);
    const task_output = {
      what: output_what,
      why: output_why,
      how: output_how,
      blockers,
      risks,
      phase: this.phase,
      references_used,
      references_reason,
      ...phaseData,
    };

    // Update status to pending_review
    const result = await planReader.updateStatus({
      id,
      status: "pending_review",
      task_output,
    });

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    await planReporter.updateAll();

    const phaseOutput = this.formatPhaseOutput(params);

    return {
      content: [
        {
          type: "text" as const,
          text: `Task "${id}" submitted for review.

Status: in_progress → pending_review

## Output Summary

### What (何をしたか)
${output_what}

### Why (なぜこれで十分か)
${output_why}

### How (どのように行ったか)
${output_how}

### Blockers (遭遇した障害)
${blockers.length > 0 ? blockers.map((b) => `- ${b}`).join("\n") : "なし"}

### Risks (リスク・懸念事項)
${risks.length > 0 ? risks.map((r) => `- ${r}`).join("\n") : "なし"}

### References (参照ドキュメント)
${references_used.map((r) => `- ${r}`).join("\n")}
**理由**: ${references_reason}

${phaseOutput}

---

**Waiting for user approval.** User can:
- \`approve(target: "task", id: "${id}")\` - Approve and complete
- \`plan(action: "request_changes", id: "${id}", comment: "<feedback>")\` - Request changes`,
        },
      ],
    };
  }
}
