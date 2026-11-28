import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { errorResponse, textResponse, type LabContext } from "../types.js";
import { expandVars } from "../../../launch.js";
import { messageOf } from "../../../session.js";

const schema = z.object({
  action: z.literal("call"),
  session: z.string().describe("Session id from `start`"),
  tool: z.string().describe("Tool name on that server"),
  params: z
    .record(z.unknown())
    .optional()
    .describe("Arguments for the tool, as that server defines them. `{{SCRATCH}}` expands"),
});

type Args = z.infer<typeof schema>;

export class CallHandler extends BaseActionHandler<Args, LabContext> {
  readonly action = "call";
  readonly help = `Call a tool on a running session.

- \`execute(action: "call", session: "s1", tool: "instruction", args: { action: "list" })\`
- The arguments are not validated here; the server validates them and its own error comes back.`;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: LabContext }): Promise<ToolResponse> {
    const { session: id, tool, params: toolArgs } = params.args;

    const session = params.context.store.get(id);
    if (session === undefined) return errorResponse(unknownSession({ id, context: params.context }));

    const expanded = expandVars({
      value: toolArgs ?? {},
      vars: { SCRATCH: session.scratch, WORKTREE: session.spec.cwd },
    });

    try {
      const result = await session.call({ tool, args: expanded });
      // The server's own response, verbatim. Wrapping it in a summary would
      // put this server's voice between the caller and the one being tested.
      return result.isError ? errorResponse(result.text) : textResponse(result.text);
    } catch (error) {
      return errorResponse(
        `Call failed: ${messageOf(error)}\n\nThe server may have exited. \`execute(action: "logs", session: "${id}")\` for what it printed.`
      );
    }
  }
}

export function unknownSession(params: { id: string; context: LabContext }): string {
  const open = params.context.store.all().map((session) => session.id);
  return open.length === 0
    ? `No session "${params.id}". Nothing is running; start one with \`execute(action: "start", ...)\`.`
    : `No session "${params.id}". Running: ${open.join(", ")}.`;
}
