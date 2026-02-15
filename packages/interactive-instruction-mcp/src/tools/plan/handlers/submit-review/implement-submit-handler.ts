import { z } from "zod";
import type { PlanRawParams } from "../../../../types/index.js";
import { BaseSubmitHandler, baseParamsSchema } from "./base-submit-handler.js";

const fileChangeSchema = z.object({
  file: z.string().describe("File path"),
  lines: z.string().describe("Line range (e.g., '1-50')"),
  description: z.string().describe("What was changed"),
});

const implementParamsSchema = baseParamsSchema.extend({
  changes: z.array(fileChangeSchema).min(1).describe("ファイル変更（必須、最低1つ）"),
  design_decisions: z.string().describe("設計判断・なぜこの実装を選んだか"),
});

/**
 * ImplementSubmitHandler: Submit implement phase tasks for review
 */
export class ImplementSubmitHandler extends BaseSubmitHandler {
  readonly action = "submit_implement";
  readonly phase = "implement" as const;

  readonly help = `# plan submit_implement

Submit an implementation task for user review.

## Usage
\`\`\`
plan(action: "submit_implement", id: "<task-id>",
  output_what: "<what was implemented>",
  output_why: "<why this is sufficient>",
  output_how: "<how it was implemented>",
  blockers: ["<blocker1>", ...] | [],
  risks: ["<risk1>", ...] | [],
  changes: [{ file: "<path>", lines: "<range>", description: "<desc>" }, ...],
  design_decisions: "<why this approach was chosen>",
  references_used: ["prompts/<task-id>", "<ref1>", ...],
  references_reason: "<why these references>")
\`\`\`

## Parameters
- **id** (required): Task ID (must end with __implement)
- **output_what** (required): What was implemented
- **output_why** (required): Why this is sufficient
- **output_how** (required): How it was implemented
- **blockers** (required): Encountered blockers (can be empty [])
- **risks** (required): Risks and concerns (can be empty [])
- **changes** (required): Array of file changes (min 1)
- **design_decisions** (required): Why this implementation approach was chosen
- **references_used** (required): Array of references (must include prompts/<task-id>)
- **references_reason** (required): Why these references were used
`;

  protected validatePhaseFields(params: { rawParams: PlanRawParams }): string | null {
    const result = implementParamsSchema.safeParse(params.rawParams);
    if (!result.success) {
      const errors = result.error.errors
        .filter((e) => e.path[0] === "changes" || e.path[0] === "design_decisions")
        .map((e) => `${e.path.join(".")}: ${e.message}`);
      if (errors.length > 0) {
        return errors.join(", ");
      }
    }
    return null;
  }

  protected getPhaseData(params: { rawParams: PlanRawParams }): Record<string, unknown> {
    const result = implementParamsSchema.safeParse(params.rawParams);
    if (!result.success) return {};
    return {
      changes: result.data.changes,
      design_decisions: result.data.design_decisions,
    };
  }

  protected formatPhaseOutput(params: { rawParams: PlanRawParams }): string {
    const result = implementParamsSchema.safeParse(params.rawParams);
    if (!result.success) return "";
    const { changes, design_decisions } = result.data;
    return `### Changes (ファイル変更)
${changes.map((c) => `- \`${c.file}\` (${c.lines}): ${c.description}`).join("\n")}

### Design Decisions (設計判断)
${design_decisions}`;
  }
}
