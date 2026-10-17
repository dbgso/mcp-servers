import { z } from "zod";
import { BaseActionHandler, looseArray, type ToolResponse } from "mcp-shared";
import type { AddResult } from "../../chain.js";
import { formatFindings } from "../../checks.js";
import { errorResponse, fieldsSchema, formatClaim, formatGap, retryOf, textResponse, type ChainContext } from "../types.js";

const schema = z.object({
  action: z.literal("add"),
  kind: z.string().min(1),
  fields: fieldsSchema,
  refs: looseArray(z.array(z.string())).default([]),
  want: z.string().min(1).optional(),
  resolves: z.string().min(1).optional(),
});

type Args = z.infer<typeof schema>;

function addedText(result: Extract<AddResult, { outcome: "added" }>): string {
  const lines = [`Added **${result.claim.id}**.`, "", formatClaim(result.claim)];
  if (result.resolved !== undefined) lines.push("", `Resolved ${result.resolved}.`);
  if (result.unblocked.length > 0) {
    lines.push("", "# Now writable", "", "These gaps were waiting for this claim:", "");
    for (const gap of result.unblocked) {
      lines.push(formatGap(gap), "", `\`${retryOf({ gap, by: result.claim.id })}\``, "");
    }
  }
  return lines.join("\n");
}

function gapText(result: Extract<AddResult, { outcome: "gap" }>): string {
  const lines = [
    "Not written: upstream has not decided this yet. Recorded what is missing:",
    "",
    ...result.gaps.map(formatGap),
    "",
    "Write the missing claim upstream. When it is added, this draft is listed as writable again.",
  ];
  return lines.join("\n");
}

function rejectedText(result: Extract<AddResult, { outcome: "rejected" }>): string {
  const lines = ["Not written.", "", formatFindings(result.findings)];
  if (result.needsWant) {
    lines.push(
      "",
      "What it has to cite does not exist yet. Say what upstream has not decided with `want`, and it is recorded as a gap."
    );
  }
  return lines.join("\n");
}

export class AddHandler extends BaseActionHandler<Args, ChainContext> {
  readonly action = "add";
  readonly help = `Write a claim. It is given an id only if it cites what its kind has to cite.

- \`execute(action: "add", kind: "P", fields: { modality: "must_not", statement: "..." }, refs: ["DEF-0001"])\`
- \`want: "<what upstream has not decided>"\` -- when what it has to cite does not exist yet, record that as a gap instead of failing silently
- \`resolves: "GAP-0001"\` -- close the gap this claim was waiting on`;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: ChainContext }): Promise<ToolResponse> {
    const { kind, fields, refs, want, resolves } = params.args;
    const result = await params.context.chain.add({ kind, fields, refs, want, resolves });

    if (result.outcome === "added") return textResponse(addedText(result));
    if (result.outcome === "gap") return errorResponse(gapText(result));
    return errorResponse(rejectedText(result));
  }
}
