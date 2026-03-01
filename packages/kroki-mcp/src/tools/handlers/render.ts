import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "mcp-shared";
import { getErrorMessage } from "mcp-shared";
import { getAllTools, getTool } from "../../diagrams/registry.js";

const RenderSchema = z.object({
  tool: z.string().describe("Diagram tool ID (e.g., 'mermaid', 'plantuml')"),
  diagram: z.string().describe("The diagram source code"),
  format: z.enum(["svg", "png", "pdf"]).optional().default("svg").describe("Output format"),
  output_path: z.string().optional().describe("File path to save the output (optional)"),
});

type RenderArgs = z.infer<typeof RenderSchema>;

export class KrokiRenderHandler extends BaseToolHandler<RenderArgs> {
  readonly name = "kroki_render";
  readonly description = "Render a diagram using Kroki. Returns the diagram as SVG (default), PNG, or PDF.";
  readonly schema = RenderSchema;
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      tool: {
        type: "string",
        description: "Diagram tool ID (e.g., 'mermaid', 'plantuml')",
      },
      diagram: {
        type: "string",
        description: "The diagram source code",
      },
      format: {
        type: "string",
        enum: ["svg", "png", "pdf"],
        description: "Output format (default: svg)",
      },
      output_path: {
        type: "string",
        description: "File path to save the output (optional)",
      },
    },
    required: ["tool", "diagram"],
  };

  protected async doExecute(args: RenderArgs): Promise<ToolResponse> {
    const { tool, diagram, format, output_path } = args;

    // Validate tool exists
    const toolInfo = getTool(tool);
    if (!toolInfo) {
      const available = getAllTools().map(t => t.id).join(", ");
      return {
        content: [{ type: "text", text: `Unknown tool: "${tool}"\n\nAvailable: ${available}` }],
        isError: true,
      };
    }

    // Call Kroki API
    try {
      const krokiUrl = process.env.KROKI_URL ?? "https://kroki.io";
      const response = await fetch(`${krokiUrl}/${tool}/${format}`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
        },
        body: diagram,
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{ type: "text", text: `Kroki error (${response.status}): ${errorText}` }],
          isError: true,
        };
      }

      if (format === "svg") {
        const svg = await response.text();

        // Save to file if output_path specified
        if (output_path) {
          await writeFile(output_path, svg, "utf-8");
          return {
            content: [{ type: "text", text: `Saved to ${output_path}` }],
          };
        }

        return {
          content: [{ type: "text", text: svg }],
        };
      } else {
        // PNG/PDF - return as base64 or save to file
        const buffer = await response.arrayBuffer();

        // Save to file if output_path specified
        if (output_path) {
          await writeFile(output_path, Buffer.from(buffer));
          return {
            content: [{ type: "text", text: `Saved to ${output_path}` }],
          };
        }

        const base64 = Buffer.from(buffer).toString("base64");
        const mimeType = format === "png" ? "image/png" : "application/pdf";
        return {
          content: [
            {
              type: "image",
              data: base64,
              mimeType,
            },
          ],
        };
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to render diagram: ${getErrorMessage(error)}` }],
        isError: true,
      };
    }
  }
}
