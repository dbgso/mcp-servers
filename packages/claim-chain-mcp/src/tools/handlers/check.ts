import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { formatFindings, hasErrors } from "../../checks.js";
import { errorResponse, textResponse, type ChainContext } from "../types.js";

const schema = z.object({
  action: z.literal("check"),
});

type Args = z.infer<typeof schema>;

export class CheckHandler extends BaseActionHandler<Args, ChainContext> {
  readonly action = "check";
  readonly help = `Check every claim: what it cites exists and is of a kind it may cite, in the right number, at the version it was written against; and everything that has to have something below it does.

- \`execute(action: "check")\`

The same check runs from the command line: \`claim-chain-mcp check <root>\` exits 1 on any error.`;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: ChainContext }): Promise<ToolResponse> {
    const findings = await params.context.chain.check();
    const text = formatFindings(findings);
    return hasErrors(findings) ? errorResponse(text) : textResponse(text);
  }
}
