import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import { errorResponse, textResponse, type LabContext } from "../types.js";
import { unknownSession } from "./call.js";

const schema = z.object({
  action: z.literal("stop"),
  session: z.string().optional().describe("Session id; omit with `all: true`"),
  all: z.boolean().optional().describe("Stop every running session"),
  keepScratch: z.boolean().optional().describe("Keep the scratch directory instead of removing it"),
});

type Args = z.infer<typeof schema>;

export class StopHandler extends BaseActionHandler<Args, LabContext> {
  readonly action = "stop";
  readonly help = `Stop a session and remove its scratch directory.

- \`execute(action: "stop", session: "s1")\`
- \`execute(action: "stop", all: true)\`
- \`keepScratch: true\` leaves the files behind to look at.`;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: LabContext }): Promise<ToolResponse> {
    const { session: id, all, keepScratch = false } = params.args;
    const { store } = params.context;

    if (all === true) {
      const stopped = store.all().map((session) => session.id);
      await store.stopAll();
      return textResponse(stopped.length === 0 ? "Nothing was running." : `Stopped: ${stopped.join(", ")}.`);
    }

    if (id === undefined) {
      return errorResponse("Pass `session`, or `all: true` to stop everything.");
    }

    const session = store.get(id);
    if (session === undefined) return errorResponse(unknownSession({ id, context: params.context }));

    await session.stop({ keepScratch });
    store.remove(id);

    return textResponse(
      keepScratch ? `Stopped ${id}. Scratch kept at ${session.scratch}` : `Stopped ${id}.`
    );
  }
}
