import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import type { TraceNode } from "../../chain.js";
import { textResponse, type ChainContext } from "../types.js";

const schema = z.object({
  action: z.literal("trace"),
  id: z.string().min(1),
  direction: z.enum(["up", "down"]).default("up"),
});

type Args = z.infer<typeof schema>;

function render(params: { node: TraceNode; depth: number }): string[] {
  const { node, depth } = params;
  const line = `${"  ".repeat(depth)}- ${node.id}`;
  return [line, ...node.children.flatMap((child) => render({ node: child, depth: depth + 1 }))];
}

export class TraceHandler extends BaseActionHandler<Args, ChainContext> {
  readonly action = "trace";
  readonly help = `Follow citations from a claim: \`up\` to what it rests on, \`down\` to what rests on it.

- \`execute(action: "trace", id: "S-0001")\` -- up is the default
- \`execute(action: "trace", id: "P-0001", direction: "down")\``;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: ChainContext }): Promise<ToolResponse> {
    const tree = await params.context.chain.trace(params.args);
    return textResponse(render({ node: tree, depth: 0 }).join("\n"));
  }
}
