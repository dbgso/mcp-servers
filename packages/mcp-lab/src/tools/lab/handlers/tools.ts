import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { errorResponse, textResponse, toolListLines, type LabContext } from "../types.js";
import { unknownSession } from "./call.js";

const schema = z.object({
  action: z.literal("tools"),
  session: z.string().describe("Session id from `start`"),
  tool: z.string().optional().describe("One tool, with its full input schema"),
});

type Args = z.infer<typeof schema>;

export class ToolsHandler extends BaseActionHandler<Args, LabContext> {
  readonly action = "tools";
  readonly help = `List a session's tools, or show one tool's input schema.

- \`execute(action: "tools", session: "s1")\`
- \`execute(action: "tools", session: "s1", tool: "instruction")\``;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: LabContext }): Promise<ToolResponse> {
    const { session: id, tool } = params.args;

    const session = params.context.store.get(id);
    if (session === undefined) return errorResponse(unknownSession({ id, context: params.context }));

    const tools = await session.listTools();

    if (tool === undefined) {
      return textResponse(
        [`# Tools on ${id}`, "", ...toolListLines(tools)].join("\n")
      );
    }

    const found = tools.find((t) => t.name === tool);
    if (found === undefined) {
      return errorResponse(`No tool "${tool}" on ${id}. Available: ${tools.map((t) => t.name).join(", ")}`);
    }

    return textResponse(
      [
        `# ${found.name}`,
        "",
        found.description ?? "",
        "",
        "## Input schema",
        "",
        "```json",
        JSON.stringify(found.inputSchema, null, 2),
        "```",
      ].join("\n")
    );
  }
}
