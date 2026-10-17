import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { formatGap, textResponse, type ChainContext } from "../types.js";

const schema = z.object({
  action: z.literal("gaps"),
});

type Args = z.infer<typeof schema>;

export class GapsHandler extends BaseActionHandler<Args, ChainContext> {
  readonly action = "gaps";
  readonly help = `What upstream has not decided yet, and what is waiting on it.

- \`execute(action: "gaps")\``;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: ChainContext }): Promise<ToolResponse> {
    const gaps = await params.context.chain.gaps();
    if (gaps.length === 0) return textResponse("No open gaps.");
    return textResponse(gaps.map(formatGap).join("\n\n"));
  }
}
