import { z } from "zod";
import type { PlanRawParams } from "../../../../types/index.js";
import { BaseSubmitHandler, baseParamsSchema } from "./base-submit-handler.js";

const planParamsSchema = baseParamsSchema.extend({
  findings: z.string().describe("Research findings and discoveries"),
  sources: z.array(z.string()).describe("Sources investigated (URLs, file paths, etc.)"),
});

/**
 * PlanSubmitHandler: Submit plan phase tasks for review
 */
export class PlanSubmitHandler extends BaseSubmitHandler {
  readonly action = "submit_plan";
  readonly phase = "plan" as const;

  readonly help = `# plan submit_plan

Submit a plan task for user review.

## Usage
\`\`\`
plan(action: "submit_plan", id: "<task-id>",
  output_what: "<what was investigated>",
  output_why: "<why this is sufficient>",
  output_how: "<how it was investigated>",
  blockers: ["<blocker1>", ...] | [],
  risks: ["<risk1>", ...] | [],
  findings: "<research findings>",
  sources: ["<source1>", "<source2>", ...],
  references_used: ["prompts/<task-id>", "<ref1>", ...],
  references_reason: "<why these references>")
\`\`\`

## Parameters
- **id** (required): Task ID (must end with __plan)
- **output_what** (required): What was investigated
- **output_why** (required): Why this is sufficient
- **output_how** (required): How it was investigated
- **blockers** (required): Encountered blockers (can be empty [])
- **risks** (required): Risks and concerns (can be empty [])
- **findings** (required): Research findings and discoveries
- **sources** (required): Sources investigated (URLs, file paths, etc.)
- **references_used** (required): Array of references (must include prompts/<task-id>)
- **references_reason** (required): Why these references were used
`;

  protected validatePhaseFields(params: { rawParams: PlanRawParams }): string | null {
    const result = planParamsSchema.safeParse(params.rawParams);
    if (!result.success) {
      const errors = result.error.errors
        .filter((e) => e.path[0] === "findings" || e.path[0] === "sources")
        .map((e) => `${e.path.join(".")}: ${e.message}`);
      if (errors.length > 0) {
        return errors.join(", ");
      }
    }
    return null;
  }

  protected getPhaseData(params: { rawParams: PlanRawParams }): Record<string, unknown> {
    const result = planParamsSchema.safeParse(params.rawParams);
    if (!result.success) return {};
    return {
      findings: result.data.findings,
      sources: result.data.sources,
    };
  }

  protected formatPhaseOutput(params: { rawParams: PlanRawParams }): string {
    const result = planParamsSchema.safeParse(params.rawParams);
    if (!result.success) return "";
    const { findings, sources } = result.data;
    return `### Findings
${findings}

### Sources
${sources.map((s) => `- ${s}`).join("\n")}`;
  }
}
