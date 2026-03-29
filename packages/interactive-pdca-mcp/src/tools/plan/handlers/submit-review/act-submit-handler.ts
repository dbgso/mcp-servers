import { z } from "zod";
import type { PlanRawParams } from "../../../../types/index.js";
import { BaseSubmitHandler, baseParamsSchema } from "./base-submit-handler.js";

const fileChangeSchema = z.object({
  file: z.string().describe("File path"),
  lines: z.string().describe("Line range (e.g., '1-50')"),
  description: z.string().describe("What was changed"),
});

const actParamsSchema = baseParamsSchema.extend({
  changes: z.array(fileChangeSchema).min(1).describe("File changes (required, at least 1)"),
  feedback_addressed: z.string().describe("What feedback was addressed"),
});

/**
 * ActSubmitHandler: Submit act phase tasks for review
 */
export class ActSubmitHandler extends BaseSubmitHandler {
  readonly action = "submit_act";
  readonly phase = "act" as const;

  readonly help = `# plan submit_act

Submit an act task for user review.

## Usage
\`\`\`
plan(action: "submit_act", id: "<task-id>",
  output_what: "<what was fixed>",
  output_why: "<why this is sufficient>",
  output_how: "<how it was fixed>",
  blockers: ["<blocker1>", ...] | [],
  risks: ["<risk1>", ...] | [],
  changes: [{ file: "<path>", lines: "<range>", description: "<desc>" }, ...],
  feedback_addressed: "<what feedback was addressed>",
  references_used: ["prompts/<task-id>", "<ref1>", ...],
  references_reason: "<why these references>")
\`\`\`

## Parameters
- **id** (required): Task ID (must end with __act)
- **output_what** (required): What was fixed
- **output_why** (required): Why this is sufficient
- **output_how** (required): How it was fixed
- **blockers** (required): Encountered blockers (can be empty [])
- **risks** (required): Risks and concerns (can be empty [])
- **changes** (required): Array of file changes (min 1)
- **feedback_addressed** (required): What feedback was addressed
- **references_used** (required): Array of references (must include prompts/<task-id>)
- **references_reason** (required): Why these references were used
`;

  protected validatePhaseFields(rawParams: PlanRawParams): string | null {
    const result = actParamsSchema.safeParse(rawParams);
    if (!result.success) {
      const errors = result.error.errors
        .filter((e) => e.path[0] === "changes" || e.path[0] === "feedback_addressed")
        .map((e) => `${e.path.join(".")}: ${e.message}`);
      if (errors.length > 0) {
        return errors.join(", ");
      }
    }
    return null;
  }

  protected getPhaseData(rawParams: PlanRawParams): Record<string, unknown> {
    const result = actParamsSchema.safeParse(rawParams);
    if (!result.success) return {};
    return {
      changes: result.data.changes,
      feedback_addressed: result.data.feedback_addressed,
    };
  }

  protected formatPhaseOutput(rawParams: PlanRawParams): string {
    const result = actParamsSchema.safeParse(rawParams);
    if (!result.success) return "";
    const { changes, feedback_addressed } = result.data;
    return `### Changes
${changes.map((c) => `- \`${c.file}\` (${c.lines}): ${c.description}`).join("\n")}

### Feedback Addressed
${feedback_addressed}`;
  }
}
