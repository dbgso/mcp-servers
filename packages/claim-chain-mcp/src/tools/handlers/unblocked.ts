import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { formatGap, retryOf, textResponse, type ChainContext } from "../types.js";

const schema = z.object({
  action: z.literal("unblocked"),
  id: z.string().min(1),
});

type Args = z.infer<typeof schema>;

export class UnblockedHandler extends BaseActionHandler<Args, ChainContext> {
  readonly action = "unblocked";
  readonly help = `The open gaps a claim answers, and how to write what was waiting on each.

- \`execute(action: "unblocked", id: "C-0003")\``;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: ChainContext }): Promise<ToolResponse> {
    const { id } = params.args;
    const gaps = await params.context.chain.unblocked(id);
    if (gaps.length === 0) return textResponse(`No open gap is waiting for ${id}.`);
    const blocks = gaps.map((gap) => `${formatGap(gap)}\n\n\`${retryOf({ gap, by: id })}\``);
    return textResponse(blocks.join("\n\n"));
  }
}
