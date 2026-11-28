import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { summaryOf, textResponse, type ChainContext } from "../types.js";

const schema = z.object({
  action: z.literal("list"),
  kind: z.string().min(1).optional(),
});

type Args = z.infer<typeof schema>;

export class ListHandler extends BaseActionHandler<Args, ChainContext> {
  readonly action = "list";
  readonly help = `The claims, one line each.

- \`execute(action: "list")\`
- \`execute(action: "list", kind: "C")\``;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: ChainContext }): Promise<ToolResponse> {
    const claims = await params.context.chain.list(params.args.kind);
    if (claims.length === 0) return textResponse("No claims.");
    return textResponse(claims.map((claim) => `- ${summaryOf(claim)}`).join("\n"));
  }
}
