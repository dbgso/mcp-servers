import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { textResponse, type LabContext } from "../types.js";

const schema = z.object({
  action: z.literal("list"),
});

type Args = z.infer<typeof schema>;

export class ListHandler extends BaseActionHandler<Args, LabContext> {
  readonly action = "list";
  readonly help = `The sessions running right now.

- \`execute(action: "list")\``;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: LabContext }): Promise<ToolResponse> {
    const sessions = params.context.store.all();

    if (sessions.length === 0) {
      return textResponse('No sessions running. Start one with `execute(action: "start", ...)`.');
    }

    const lines = ["# Sessions", ""];
    for (const session of sessions) {
      const info = session.info();
      lines.push(
        `## ${info.id}`,
        `- **command**: \`${info.spec.command} ${info.spec.args.join(" ")}\``,
        `- **cwd**: ${info.spec.cwd}`,
        `- **scratch**: ${info.scratch}`,
        `- **started**: ${info.startedAt}`,
        ""
      );
    }

    return textResponse(lines.join("\n"));
  }
}
