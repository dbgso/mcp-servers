import { z } from "zod";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { describeOperation } from "../../operations/describe-ops.js";

const DescribeSchema = z.object({
  tool: z.string().optional().describe("Diagram tool ID (e.g., 'mermaid', 'plantuml', 'd2'). Omit for overview."),
  subDiagram: z.string().optional().describe("Sub-diagram type within the tool"),
});

type DescribeArgs = z.infer<typeof DescribeSchema>;

export class KrokiDescribeHandler extends BaseToolHandler<DescribeArgs> {
  readonly name = "kroki_describe";
  readonly description = "Get diagram tool guidelines. Without arguments: lists all tools with use case recommendations. With tool argument: detailed guidelines for that tool. With tool + subDiagram: focused guide for specific diagram type.";
  readonly schema = DescribeSchema;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      tool: {
        type: "string",
        description: "Diagram tool ID (e.g., 'mermaid', 'plantuml', 'd2'). Omit for overview.",
      },
      subDiagram: {
        type: "string",
        description: "Sub-diagram type within the tool",
      },
    },
  };

  protected async doExecute(args: DescribeArgs): Promise<ToolResponse> {
    const result = await describeOperation.execute(args);
    return result as ToolResponse;
  }
}
