import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { reportSchema } from "mcp-shared-report";
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

const DESCRIBE_DESCRIPTION =
  "How to report with this server: the criteria behind each field, the page order, and an example.";

const EXEC_DESCRIPTION =
  "Write a report as an HTML page for a person to read. Every required field must be filled; " +
  "a report missing one is not written. Call `describe` for the criteria and an example.";

/** What `exec` advertises: the report, field for field, with `op` in front. */
const EXEC_INPUT = z.object({ op: z.literal("report") }).merge(reportSchema);

/**
 * The tool list, with `exec` advertising every field of the report.
 *
 * `report` is the only op, so one schema describes every call exactly and a
 * caller sees the required fields without reading anything first
 * (`policy__mcp-tool-surface`, the one-op exception). The schema is published
 * here, not registered, because the SDK validates against a registered schema
 * before the handler runs and answers with its own error, which names no
 * criterion and stops at what zod reports. Registered, `exec` stays
 * `passthrough`, and `validateReport` returns every problem with its criterion.
 */
function listTools(): { tools: Tool[] } {
  const execInput = toJsonSchemaCompat(EXEC_INPUT, { strictUnions: true, pipeStrategy: "input" });
  return {
    tools: [
      { name: "describe", description: DESCRIBE_DESCRIPTION, inputSchema: { type: "object", properties: {} } },
      { name: "exec", description: EXEC_DESCRIPTION, inputSchema: execInput as Tool["inputSchema"] },
    ],
  };
}

/**
 * The server: `describe`, and `exec` with its operation.
 *
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
    { description: DESCRIBE_DESCRIPTION },
    () => textResult({ text: buildDescribeText() }),
  );

  server.registerTool(
    "exec",
    {
      description: EXEC_DESCRIPTION,
      inputSchema: z.object({}).passthrough(),
    },
    (args) => runOp({ ops, args }),
  );
  // Registered after the tools, so it replaces the list the SDK set up for them.
  server.server.setRequestHandler(ListToolsRequestSchema, listTools);

  return server;
}
