import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { allOperations, getOperation, getOperationsByCategory } from "../../operations/registry.js";

const DescribeSchema = z.object({
  operation: z.string().optional().describe("Operation ID for details (omit for full list)"),
});

type DescribeArgs = z.infer<typeof DescribeSchema>;

export class GitDescribeHandler extends BaseToolHandler<DescribeArgs> {
  readonly name = "git_describe";
  readonly description = "List available git operations or get details for a specific operation. Use without arguments to see all operations, or specify an operation ID for details including parameter schema.";
  readonly schema = DescribeSchema;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      operation: {
        type: "string",
        description: "Operation ID for details (omit for full list)",
      },
    },
  };

  protected async doExecute(args: DescribeArgs): Promise<ToolResponse> {
    const { operation } = args;

    // Detail mode
    if (operation) {
      const op = getOperation(operation);
      if (!op) {
        const available = allOperations.map(o => o.id).join(", ");
        return {
          content: [{ type: "text", text: `Unknown operation: "${operation}"\n\nAvailable operations: ${available}` }],
          isError: true,
        };
      }

      const jsonSchema = zodToJsonSchema(op.argsSchema, { target: "openApi3" });

      const lines = [
        `## ${op.id}`,
        ``,
        `**Category:** ${op.category}`,
        ``,
        `Use \`git_execute({ operation: "${op.id}", params: {...} })\` to execute.`,
        ``,
        op.detail,
        ``,
        `**Parameters (JSON Schema):**`,
        "```json",
        JSON.stringify(jsonSchema, null, 2),
        "```",
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }

    // List mode
    const byCategory = getOperationsByCategory();
    const lines = [
      `# Git Operations (${allOperations.length} total)`,
      ``,
      `All operations are read-only. Omit repo_url to use current working directory.`,
      ``,
      `Use \`git_describe({ operation: "<id>" })\` for details.`,
      `Use \`git_execute({ operation: "<id>", params: {...} })\` to execute.`,
      ``,
    ];

    for (const [category, ops] of Object.entries(byCategory)) {
      lines.push(`## ${category}`);
      for (const op of ops) {
        lines.push(`- **${op.id}**: ${op.summary}`);
      }
      lines.push("");
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  }
}
