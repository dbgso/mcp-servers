import { z } from "zod";
import type { PlanRawParams } from "../../../../types/index.js";
import { BaseSubmitHandler, baseParamsSchema } from "./base-submit-handler.js";

const checkParamsSchema = baseParamsSchema.extend({
  test_target: z.string().describe("Test target - what was tested"),
  test_results: z.string().describe("Test results - success/failure details"),
  coverage: z.string().describe("Coverage - how much was covered"),
});

/**
 * CheckSubmitHandler: Submit check phase tasks for review
 */
export class CheckSubmitHandler extends BaseSubmitHandler {
  readonly action = "submit_check";
  readonly phase = "check" as const;

  readonly help = `# plan submit_check

Submit a verification task for user review.

## Usage
\`\`\`
plan(action: "submit_check", id: "<task-id>",
  output_what: "<what was verified>",
  output_why: "<why this is sufficient>",
  output_how: "<how it was verified>",
  blockers: ["<blocker1>", ...] | [],
  risks: ["<risk1>", ...] | [],
  test_target: "<what was tested>",
  test_results: "<test results with code blocks>",
  coverage: "<coverage details>",
  references_used: ["prompts/<task-id>", "<ref1>", ...],
  references_reason: "<why these references>")
\`\`\`

## Parameters
- **id** (required): Task ID (must end with __check)
- **output_what** (required): What was verified
- **output_why** (required): Why this is sufficient
- **output_how** (required): How it was verified
- **blockers** (required): Encountered blockers (can be empty [])
- **risks** (required): Risks and concerns (can be empty [])
- **test_target** (required): What was tested
- **test_results** (required): Test results with commands and output in code blocks
- **coverage** (required): Coverage details (how much was covered)
- **references_used** (required): Array of references (must include prompts/<task-id>)
- **references_reason** (required): Why these references were used

## Example test_results format
\`\`\`
**typecheck:**
\\\`\\\`\\\`
$ pnpm typecheck
> tsc --noEmit
(no errors)
\\\`\\\`\\\`

**test:**
\\\`\\\`\\\`
$ pnpm test
✓ 207 tests passed
\\\`\\\`\\\`

**grep check:**
\\\`\\\`\\\`
$ grep -r "output_content" src/
(no matches)
\\\`\\\`\\\`
\`\`\`
`;

  protected validatePhaseFields(params: { rawParams: PlanRawParams }): string | null {
    const result = checkParamsSchema.safeParse(params.rawParams);
    if (!result.success) {
      const errors = result.error.errors
        .filter(
          (e) =>
            e.path[0] === "test_target" || e.path[0] === "test_results" || e.path[0] === "coverage"
        )
        .map((e) => `${e.path.join(".")}: ${e.message}`);
      if (errors.length > 0) {
        return errors.join(", ");
      }
    }
    return null;
  }

  protected getPhaseData(params: { rawParams: PlanRawParams }): Record<string, unknown> {
    const result = checkParamsSchema.safeParse(params.rawParams);
    if (!result.success) return {};
    return {
      test_target: result.data.test_target,
      test_results: result.data.test_results,
      coverage: result.data.coverage,
    };
  }

  protected formatPhaseOutput(params: { rawParams: PlanRawParams }): string {
    const result = checkParamsSchema.safeParse(params.rawParams);
    if (!result.success) return "";
    const { test_target, test_results, coverage } = result.data;
    return `### Test Target
${test_target}

### Test Results
${test_results}

### Coverage
${coverage}`;
  }
}
