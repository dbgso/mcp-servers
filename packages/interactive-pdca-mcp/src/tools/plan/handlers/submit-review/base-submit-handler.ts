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
  self_review_ref: z.string().describe("Self-review help ID that was read before submitting"),
  output_what: z.string().describe("What was done"),
  output_why: z.string().describe("Why this is sufficient"),
  output_how: z.string().describe("How it was done/investigated"),
  blockers: z.array(z.string()).describe("Encountered blockers (can be empty [])"),
  risks: z.array(z.string()).describe("Risks and concerns (can be empty [])"),
  references_used: z.array(z.string()).min(1).describe("Referenced documents (required, must include prompts/{task-id})"),
  references_reason: z.string().describe("Why these references were used and how they helped"),
});

export type BaseSubmitParams = z.infer<typeof baseParamsSchema>;

/**
 * Task phase suffixes (PDCA cycle)
 */
export const TASK_PHASES = ["plan", "do", "check", "act"] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];

/**
 * Extract task phase from task ID
 * e.g., "feature-x__plan" -> "plan"
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

    // Validate self_review_ref matches expected pattern
    const expectedRef = `_mcp-interactive-instruction__plan__self-review__${this.phase}`;
    if (baseResult.data.self_review_ref !== expectedRef) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Invalid self_review_ref. Expected "${expectedRef}".

You must read the self-review requirements before submitting:
\`help(id: "${expectedRef}")\`

Then include the ID in your submission:
\`self_review_ref: "${expectedRef}"\``,
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

    // Update status to self_review (AI must confirm before user review)
    const result = await planReader.updateStatus({
      id,
      status: "completed", // Will be auto-converted to self_review
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
          text: `Task "${id}" ready for self-review.

Status: in_progress -> self_review

## Output Summary

### What
${output_what}

### Why
${output_why}

### How
${output_how}

### Blockers
${blockers.length > 0 ? blockers.map((b) => `- ${b}`).join("\n") : "None"}

### Risks
${risks.length > 0 ? risks.map((r) => `- ${r}`).join("\n") : "None"}

### References
${references_used.map((r) => `- ${r}`).join("\n")}
**Reason**: ${references_reason}

${phaseOutput}

---

## Self-Review Checklist

**Review requirements:** \`help(id: "_mcp-interactive-instruction/plan/self-review/${this.phase}")\`

**Before confirming, verify:**
${this.getSelfReviewChecklist()}

**If all requirements are met:**
\`\`\`
plan(action: "confirm", id: "${id}")
\`\`\``,
        },
      ],
    };
  }

  /**
   * Get self-review checklist for this phase
   * Override in subclasses to provide phase-specific requirements
   */
  protected getSelfReviewChecklist(): string {
    return `- [ ] Output includes specific evidence (commands executed, file contents)
- [ ] All completion criteria are addressed
- [ ] References are correctly cited`;
  }
}
