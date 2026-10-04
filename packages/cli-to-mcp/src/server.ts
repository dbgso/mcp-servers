import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, formatExecution, optionsToArgs, toArgsArray } from "./command-line.js";
import { executeCommand } from "./executor.js";
import type { ServerConfig } from "./types.js";
import { VERSION } from "./version.js";

export interface CreateServerParams {
  config?: ServerConfig;
}

export function createServer(params: CreateServerParams = {}): McpServer {
  const { config = {} } = params;

  const server = new McpServer({
    name: "cli-to-mcp",
    version: VERSION,
  });

  // Main execute tool
  server.registerTool(
    "cli_execute",
    {
      description: "Execute a CLI command.\n\nRuns any CLI command with the provided arguments.",
      inputSchema: z.object({
        command: z.string().describe("The command to execute (e.g., 'ls', 'aws', 'docker')"),
        args: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe("Command arguments (string or array)"),
        options: z
          .record(z.union([z.string(), z.boolean(), z.array(z.string())]))
          .optional()
          .describe("Command options as key-value pairs (e.g., { profile: 'dev', force: true })"),
      }),
    },
    async (input) => {
      const fullArgs = [...toArgsArray(input.args), ...optionsToArgs(input.options)];

      try {
        const result = await executeCommand({
          command: input.command,
          args: fullArgs,
          config,
        });
        return formatExecution(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // Help tool to get command help
  server.registerTool(
    "cli_help",
    {
      description: "Get help for a command",
      inputSchema: z.object({
        command: z.string().describe("The command to get help for"),
        subcommand: z
          .string()
          .optional()
          .describe("Subcommand to get help for (e.g., 's3' for 'aws s3 help')"),
      }),
    },
    async (input) => {
      const args = input.subcommand
        ? [input.subcommand, "--help"]
        : ["--help"];

      try {
        const result = await executeCommand({
          command: input.command,
          args,
          config,
        });

        return {
          content: [
            {
              type: "text",
              text: result.stdout || result.stderr,
            },
          ],
        };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // Status tool
  server.registerTool(
    "cli_status",
    {
      description: "Get CLI executor status",
      inputSchema: z.object({}),
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                cwd: config.cwd ?? process.cwd(),
                timeout: config.timeout ?? 30000,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}
