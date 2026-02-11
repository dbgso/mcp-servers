import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ChainManager } from "./chain-manager.js";
import type { ChainConfig } from "./types.js";
import {
  allQueryOperations,
  allMutateOperations,
  getQueryOperation,
  getMutateOperation,
} from "./operations/registry.js";

export function createServer(config: ChainConfig) {
  const manager = new ChainManager(config);

  const server = new Server(
    {
      name: "mcp-traceable-chain",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // ─── Tool Schemas ─────────────────────────────────────────────────────

  const DescribeSchema = z.object({
    operation: z.string().optional().describe("Operation ID for details (omit for full list)"),
  });

  const QuerySchema = z.object({
    operation: z.string().describe("Query operation ID"),
    params: z.record(z.unknown()).optional().default({}).describe("Operation parameters"),
  });

  const MutateSchema = z.object({
    operation: z.string().describe("Mutate operation ID"),
    params: z.record(z.unknown()).optional().default({}).describe("Operation parameters"),
  });

  // ─── List Tools ─────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "chain_describe",
          description: "List available operations and configured types. Use without arguments to see all operations, or specify an operation ID for details.",
          inputSchema: {
            type: "object" as const,
            properties: {
              operation: {
                type: "string",
                description: "Operation ID for details (omit for full list)",
              },
            },
          },
        },
        {
          name: "chain_query",
          description: "Execute read-only operations: read, list, trace, validate. No approval required.",
          inputSchema: {
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
          },
        },
        {
          name: "chain_mutate",
          description: "Execute write operations: create, update, delete, link. Requires approval.",
          inputSchema: {
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
          },
        },
      ],
    };
  });

  // ─── Call Tool ──────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ─── chain_describe ───────────────────────────────────────────────────

    if (name === "chain_describe") {
      const parsed = DescribeSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
          isError: true,
        };
      }

      const { operation } = parsed.data;

      // Detail mode
      if (operation) {
        const queryOp = getQueryOperation(operation);
        const mutateOp = getMutateOperation(operation);
        const op = queryOp ?? mutateOp;

        if (!op) {
          const available = [
            ...allQueryOperations.map(o => o.id),
            ...allMutateOperations.map(o => o.id),
          ].join(", ");
          return {
            content: [{ type: "text", text: `Unknown operation: "${operation}"\n\nAvailable operations: ${available}` }],
            isError: true,
          };
        }

        const jsonSchema = zodToJsonSchema(op.argsSchema, { target: "openApi3" });
        const category = queryOp ? "Query (no approval)" : "Mutate (approval required)";

        const lines = [
          `## ${op.id}`,
          ``,
          `**Category:** ${category}`,
          ``,
          `Use \`chain_${queryOp ? "query" : "mutate"}({ operation: "${op.id}", params: {...} })\` to execute.`,
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
      const types = manager.getTypes();
      const rootTypes = manager.getRootTypes();

      const lines = [
        `# Traceable Chain`,
        ``,
        `## Configured Types`,
        ``,
      ];

      for (const [typeName, cfg] of Object.entries(types)) {
        const isRoot = rootTypes.includes(typeName);
        const requires = cfg.requires === null
          ? "(root)"
          : Array.isArray(cfg.requires)
            ? cfg.requires.join(" | ")
            : cfg.requires;
        lines.push(`- **${typeName}**: requires ${requires}${cfg.description ? ` - ${cfg.description}` : ""}`);
      }

      lines.push("");
      lines.push(`## Query Operations (no approval)`);
      for (const op of allQueryOperations) {
        lines.push(`- **${op.id}**: ${op.summary}`);
      }

      lines.push("");
      lines.push(`## Mutate Operations (approval required)`);
      for (const op of allMutateOperations) {
        lines.push(`- **${op.id}**: ${op.summary}`);
      }

      lines.push("");
      lines.push(`Use \`chain_describe({ operation: "<id>" })\` for details.`);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }

    // ─── chain_query ──────────────────────────────────────────────────────

    if (name === "chain_query") {
      const parsed = QuerySchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
          isError: true,
        };
      }

      const { operation, params } = parsed.data;
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

      return op.execute(parseResult.data, { manager });
    }

    // ─── chain_mutate ─────────────────────────────────────────────────────

    if (name === "chain_mutate") {
      const parsed = MutateSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
          isError: true,
        };
      }

      const { operation, params } = parsed.data;
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

      return op.execute(parseResult.data, { manager });
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  return server;
}

export async function startServer(config: ChainConfig) {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-traceable-chain server started");
}
