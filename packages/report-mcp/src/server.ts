import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { buildDescribeText } from "./describe.js";
import { ReportOp } from "./ops/report.js";
import type { Op } from "./ops/types.js";
import { VERSION } from "./version.js";

export const SERVER_NAME = "report-mcp";

function textResult(params: { text: string; isError?: boolean }): CallToolResult {
  const { text, isError } = params;
  return isError === true ? { content: [{ type: "text", text }], isError } : { content: [{ type: "text", text }] };
}

/** What was wrong with `op`, and what it can be instead. */
function unknownOpText(params: { ops: ReadonlyMap<string, Op>; given: unknown }): string {
  const { ops, given } = params;
  const names = [...ops.keys()].map((name) => `"${name}"`).join(", ");
  const lead = given === undefined ? "No `op` was given" : `Unknown op: ${JSON.stringify(given)}`;
  return `${lead}. \`op\` is one of ${names}. Call \`describe\` for what each takes.`;
}

/** Pick the operation `op` names, or say what `op` can be. */
async function runOp(params: { ops: ReadonlyMap<string, Op>; args: Record<string, unknown> }): Promise<CallToolResult> {
  const { ops, args } = params;
  const op = typeof args.op === "string" ? ops.get(args.op) : undefined;
  if (op === undefined) {
    return textResult({ text: unknownOpText({ ops, given: args.op }), isError: true });
  }
  return op.execute(args);
}

/**
 * The server: `describe`, and `exec` with its operations.
 *
 * `exec`'s schema is `passthrough` and names no argument
 * (`policy__mcp-tool-surface`). An empty shape would publish the same
 * nothing and then have the SDK discard every argument before the handler ran.
 * No `approve`: the only operation creates a new file in a directory of its
 * own and never changes or removes anything.
 */
export function createServer(params: { outputDir: string; now?: () => Date }): McpServer {
  const { outputDir, now } = params;
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  const ops: ReadonlyMap<string, Op> = new Map(
    [new ReportOp(outputDir, now)].map((op): [string, Op] => [op.name, op]),
  );

  server.registerTool(
    "describe",
    { description: "How to report with this server: the report's fields, what each is for, and an example. Read before calling exec." },
    () => textResult({ text: buildDescribeText() }),
  );

  server.registerTool(
    "exec",
    {
      description:
        "Write a report as an HTML page for a person to read. The arguments are not described here -- call `describe` for them.",
      inputSchema: z.object({}).passthrough(),
    },
    (args) => runOp({ ops, args }),
  );

  return server;
}
