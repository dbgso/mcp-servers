import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { allOperations, getOperation, getOperationsByCategory } from "./operations/registry.js";
import { resolveRepo } from "./git-repo-manager.js";
import { getErrorMessage } from "mcp-shared";

const server = new Server(
  {
    name: "mcp-git-repo-explorer",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─── Tool Schemas ─────────────────────────────────────────────────────────

const GitDescribeSchema = z.object({
  operation: z.string().optional().describe("Operation ID for details (omit for full list)"),
});

const GitExecuteSchema = z.object({
  operation: z.string().describe("Operation ID (use git_describe to see available operations)"),
  params: z.record(z.unknown()).optional().default({}).describe("Operation-specific parameters"),
});

// ─── List Tools ───────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "git_describe",
        description: "List available git operations or get details for a specific operation. Use without arguments to see all operations, or specify an operation ID for details including parameter schema.",
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
        name: "git_execute",
        description: "Execute a git operation (all read-only). Use git_describe to see available operations and parameters. Omit repo_url to use current working directory.",
        inputSchema: {
          type: "object" as const,
          properties: {
            operation: {
              type: "string",
              description: "Operation ID (use git_describe to see available operations)",
            },
            params: {
              type: "object",
              description: "Operation-specific parameters",
            },
          },
          required: ["operation"],
        },
      },
    ],
  };
});

// ─── Call Tool ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "git_describe") {
    const parsed = GitDescribeSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
        isError: true,
      };
    }

    const { operation } = parsed.data;

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

  if (name === "git_execute") {
    const parsed = GitExecuteSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
        isError: true,
      };
    }

    const { operation, params } = parsed.data;

    // 1. Lookup operation
    const op = getOperation(operation);
    if (!op) {
      const available = allOperations.map(o => o.id).join(", ");
      return {
        content: [{ type: "text", text: `Unknown operation: "${operation}"\n\nAvailable operations: ${available}` }],
        isError: true,
      };
    }

    // 2. Validate params with Zod
    const parseResult = op.argsSchema.safeParse(params);
    if (!parseResult.success) {
      const errors = parseResult.error.issues
        .map(i => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      return {
        content: [{ type: "text", text: `Validation error for "${operation}":\n${errors}\n\nUse git_describe({ operation: "${operation}" }) to see the parameter schema.` }],
        isError: true,
      };
    }

    const validatedArgs = parseResult.data as Record<string, any>;

    // 3. Resolve repo: remote clone if repo_url specified, local cwd otherwise
    try {
      const { repoPath, repoName } = await resolveRepo(validatedArgs.repo_url);

      // 4. Execute
      const result = await op.execute(validatedArgs, { repoPath, repoName });
      return result;
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error executing git ${operation}: ${getErrorMessage(error)}` }],
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
  console.error("mcp-git-repo-explorer server started");
}
