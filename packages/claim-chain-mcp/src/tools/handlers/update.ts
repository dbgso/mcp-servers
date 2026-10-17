import { z } from "zod";
import { BaseActionHandler, looseArray, type ToolResponse } from "mcp-shared";
import { formatFindings } from "../../checks.js";
import { errorResponse, fieldsSchema, formatClaim, summaryOf, textResponse, type ChainContext } from "../types.js";

const schema = z.object({
  action: z.literal("update"),
  id: z.string().min(1),
  fields: fieldsSchema.optional(),
  refs: looseArray(z.array(z.string())).optional(),
});

type Args = z.infer<typeof schema>;

export class UpdateHandler extends BaseActionHandler<Args, ChainContext> {
  readonly action = "update";
  readonly help = `Change a claim's fields or its citations.

- \`execute(action: "update", id: "C-0001", fields: { condition: "..." })\` -- replaces all the fields
- \`execute(action: "update", id: "S-0001", refs: ["C-0001"])\` -- replaces the citations, pinned to what they say now. This is how a stale citation is confirmed

A change to the fields gives the claim a new version, and every claim citing it becomes stale until it is confirmed.`;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: ChainContext }): Promise<ToolResponse> {
    const { id, fields, refs } = params.args;
    const result = await params.context.chain.update({ id, fields, refs });

    if (result.outcome === "rejected") {
      return errorResponse(`Not updated.\n\n${formatFindings(result.findings)}`);
    }

    const lines = [`Updated **${result.claim.id}**.`, "", formatClaim(result.claim)];
    if (result.nowStale.length > 0) {
      lines.push("", "# Now stale", "", "These cite the old version. Check each still holds, then confirm its refs:", "");
      lines.push(...result.nowStale.map((claim) => `- ${summaryOf(claim)}`));
    }
    return textResponse(lines.join("\n"));
  }
}
