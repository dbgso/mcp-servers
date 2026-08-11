import { z } from "zod";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import type { ChainManager } from "../../chain-manager.js";
import { allQueryOperations, getQueryOperation } from "../../operations/registry.js";

const QuerySchema = z.object({
  operation: z.string().describe("Query operation ID"),
  params: z.record(z.unknown()).optional().default({}).describe("Operation parameters"),
});

type QueryArgs = z.infer<typeof QuerySchema>;

export class ChainQueryHandler extends BaseToolHandler<QueryArgs> {
  readonly name = "chain_query";
  readonly description = "Execute read-only operations: read, list, trace, validate. No approval required.";
  readonly schema = QuerySchema;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      operation: {
        type: "string",
        description: "Query operation ID",
      },
      params: {
        type: "object",
        description: "Operation parameters",
      },
    },
    required: ["operation"],
  };

  constructor(private readonly manager: ChainManager) {
    super();
  }

  protected async doExecute(args: QueryArgs): Promise<ToolResponse> {
    const { operation, params } = args;
    const op = getQueryOperation(operation);

    if (!op) {
      const available = allQueryOperations.map(o => o.id).join(", ");
      return {
        content: [{ type: "text", text: `Unknown query operation: "${operation}"\n\nAvailable: ${available}` }],
        isError: true,
      };
    }

    const parseResult = op.argsSchema.safeParse(params);
    if (!parseResult.success) {
      const errors = parseResult.error.issues
        .map(i => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      return {
        content: [{ type: "text", text: `Validation error for "${operation}":\n${errors}` }],
        isError: true,
      };
    }

    const result = await op.execute(parseResult.data, { manager: this.manager });
    return result as ToolResponse;
  }
}
