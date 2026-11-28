import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { errorResponse, textResponse, type LabContext } from "../types.js";
import { unknownSession } from "./call.js";

const schema = z.object({
  action: z.literal("logs"),
  session: z.string().describe("Session id from `start`"),
});

type Args = z.infer<typeof schema>;

export class LogsHandler extends BaseActionHandler<Args, LabContext> {
  readonly action = "logs";
  readonly help = `What the server printed on stderr.

- \`execute(action: "logs", session: "s1")\`
- The first place to look when a call fails or a server will not start.`;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: LabContext }): Promise<ToolResponse> {
    const { session: id } = params.args;

    const session = params.context.store.get(id);
    if (session === undefined) return errorResponse(unknownSession({ id, context: params.context }));

    const logs = session.logs();
    return textResponse(logs === "" ? `${id} has printed nothing on stderr.` : `# stderr of ${id}\n\n\`\`\`\n${logs}\n\`\`\``);
  }
}
