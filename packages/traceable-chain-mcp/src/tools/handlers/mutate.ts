import { z } from "zod";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import type { ChainManager } from "../../chain-manager.js";
import { allMutateOperations, getMutateOperation } from "../../operations/registry.js";

const MutateSchema = z.object({
  operation: z.string().describe("Mutate operation ID"),
  params: z.record(z.unknown()).optional().default({}).describe("Operation parameters"),
});

type MutateArgs = z.infer<typeof MutateSchema>;

export class ChainMutateHandler extends BaseToolHandler<MutateArgs> {
  readonly name = "chain_mutate";
  readonly description = "Execute write operations: create, update, delete, link. Requires approval.";
  readonly schema = MutateSchema;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      operation: {
        type: "string",
        description: "Mutate operation ID",
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

  protected async doExecute(args: MutateArgs): Promise<ToolResponse> {
    const { operation, params } = args;
    const op = getMutateOperation(operation);

    if (!op) {
      const available = allMutateOperations.map(o => o.id).join(", ");
      return {
        content: [{ type: "text", text: `Unknown mutate operation: "${operation}"\n\nAvailable: ${available}` }],
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
