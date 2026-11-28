import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { formatClaim, formatGap, summaryOf, textResponse, type ChainContext } from "../types.js";

const schema = z.object({
  action: z.literal("read"),
  id: z.string().min(1),
});

type Args = z.infer<typeof schema>;

export class ReadHandler extends BaseActionHandler<Args, ChainContext> {
  readonly action = "read";
  readonly help = `One claim or gap, and the claims that cite it.

- \`execute(action: "read", id: "P-0001")\``;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: ChainContext }): Promise<ToolResponse> {
    const { claim, gap, citers, stale } = await params.context.chain.read(params.args.id);
    const lines = [claim === undefined ? formatGap(gap as NonNullable<typeof gap>) : formatClaim(claim)];

    if (stale.length > 0) lines.push("", `**Stale**: cites an old version of ${stale.join(", ")}`);
    if (citers.length > 0) lines.push("", "# Cited by", "", ...citers.map((citer) => `- ${summaryOf(citer)}`));
    return textResponse(lines.join("\n"));
  }
}
