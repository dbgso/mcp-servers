import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { BaseToolHandler } from "mcp-shared";
import type { ToolContent, ToolResponse } from "mcp-shared";
import { getErrorMessage } from "mcp-shared";
import { getAllTools, getTool } from "../../diagrams/registry.js";

const RenderSchema = z.object({
  tool: z.string().describe("Diagram tool ID (e.g., 'mermaid', 'plantuml')"),
  diagram: z.string().describe("The diagram source code"),
  format: z.enum(["svg", "png", "pdf"]).optional().default("svg").describe("Output format"),
  output_path: z.string().optional().describe("File path to save the output (optional)"),
});

type RenderArgs = z.infer<typeof RenderSchema>;
type Format = RenderArgs["format"];

/** How a rendered diagram of one format is handed back in the conversation. */
interface OutputFormat {
  toContent(params: { data: Buffer; tool: string }): ToolContent;
}

/** SVG is text. */
class SvgOutput implements OutputFormat {
  toContent({ data }: { data: Buffer }): ToolContent {
    return { type: "text", text: data.toString("utf-8") };
  }
}

/** PNG is an image block. */
class PngOutput implements OutputFormat {
  toContent({ data }: { data: Buffer }): ToolContent {
    return { type: "image", data: data.toString("base64"), mimeType: "image/png" };
  }
}

/** A PDF is not an image: it goes back as an embedded resource. */
class PdfOutput implements OutputFormat {
  toContent({ data, tool }: { data: Buffer; tool: string }): ToolContent {
    return {
      type: "resource",
      resource: { uri: `kroki://${tool}/diagram.pdf`, mimeType: "application/pdf", blob: data.toString("base64") },
    };
  }
}

const OUTPUT_FORMATS: Record<Format, OutputFormat> = {
  svg: new SvgOutput(),
  png: new PngOutput(),
  pdf: new PdfOutput(),
};

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

      // Kept as bytes for every format, so a file is written exactly as Kroki sent it
      const data = Buffer.from(await response.arrayBuffer());

      if (output_path) {
        await writeFile(output_path, data);
        return {
          content: [{ type: "text", text: `Saved to ${output_path}` }],
        };
      }

      return { content: [OUTPUT_FORMATS[format].toContent({ data, tool })] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to render diagram: ${getErrorMessage(error)}` }],
        isError: true,
      };
    }
  }
}
