import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { getAllTools, getTool } from "./diagrams/registry.js";
import { describeOperation } from "./operations/describe-ops.js";

const server = new Server(
  {
    name: "kroki-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── Tool Schemas ─────────────────────────────────────────────────────────

const DescribeSchema = z.object({
  tool: z.string().optional().describe("Diagram tool ID (e.g., 'mermaid', 'plantuml', 'd2'). Omit for overview."),
  subDiagram: z.string().optional().describe("Sub-diagram type within the tool"),
});

const RenderSchema = z.object({
  tool: z.string().describe("Diagram tool ID (e.g., 'mermaid', 'plantuml')"),
  diagram: z.string().describe("The diagram source code"),
  format: z.enum(["svg", "png", "pdf"]).optional().default("svg").describe("Output format"),
  output_path: z.string().optional().describe("File path to save the output (optional)"),
});

// ─── List Tools ───────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "kroki_describe",
        description: "Get diagram tool guidelines. Without arguments: lists all tools with use case recommendations. With tool argument: detailed guidelines for that tool. With tool + subDiagram: focused guide for specific diagram type.",
        inputSchema: {
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
        },
      },
      {
        name: "kroki_render",
        description: "Render a diagram using Kroki. Returns the diagram as SVG (default), PNG, or PDF.",
        inputSchema: {
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
        },
      },
    ],
  };
});

// ─── Call Tool ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ─── kroki_describe ─────────────────────────────────────────────────────

  if (name === "kroki_describe") {
    const parsed = DescribeSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
        isError: true,
      };
    }

    const result = await describeOperation.execute(parsed.data);
    return result;
  }

  // ─── kroki_render ───────────────────────────────────────────────────────

  if (name === "kroki_render") {
    const parsed = RenderSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
        isError: true,
      };
    }

    const { tool, diagram, format, output_path } = parsed.data;

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
        content: [{ type: "text", text: `Failed to render diagram: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ─── Start Server ─────────────────────────────────────────────────────────

export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("kroki-mcp server started");
}
