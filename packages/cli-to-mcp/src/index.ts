#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "./server.js";
import type { CliArgs, ServerConfig } from "./types.js";
import { ServerConfigSchema } from "./types.js";

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--config":
        result.config = nextArg;
        i++;
        break;
      case "--cwd":
        result.cwd = nextArg;
        i++;
        break;
      case "--timeout":
        result.timeout = parseInt(nextArg, 10);
        i++;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
cli-to-mcp - Execute CLI commands via MCP

Usage:
  cli-to-mcp [options]

Options:
  --config       Path to configuration file
  --cwd          Working directory for command execution
  --timeout      Command timeout in milliseconds (default: 30000)
  --help, -h     Show this help message

Examples:
  # Start with defaults
  cli-to-mcp

  # With custom working directory
  cli-to-mcp --cwd /path/to/project

  # Using config file
  cli-to-mcp --config ./cli-config.json

Config file format:
  {
    "cwd": "/path/to/workdir",
    "timeout": 30000
  }

Tools provided:
  - cli_execute(command, args): Execute any CLI command
  - cli_help(command, subcommand?): Get help for a command
  - cli_status(): Get executor status
`);
}

function loadConfig(cliArgs: CliArgs): ServerConfig {
  if (cliArgs.config) {
    const configPath = resolve(cliArgs.config);
    const configContent = readFileSync(configPath, "utf-8");
    return ServerConfigSchema.parse(JSON.parse(configContent));
  }

  return {
    cwd: cliArgs.cwd,
    timeout: cliArgs.timeout,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cliArgs = parseArgs(args);
  const config = loadConfig(cliArgs);

  console.error("[cli-to-mcp] Starting MCP server");

  const server = createServer({ config });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
