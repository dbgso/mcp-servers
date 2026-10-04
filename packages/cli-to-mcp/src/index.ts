#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "./server.js";
import type { CliArgs, ServerConfig } from "./types.js";
import { ServerConfigSchema } from "./types.js";

/** What a flag does, and how many arguments it uses up, itself included. */
type FlagHandler = (params: { result: CliArgs; value: string | undefined }) => number;

const setConfig: FlagHandler = ({ result, value }) => {
  result.config = value;
  return 2;
};

const setCwd: FlagHandler = ({ result, value }) => {
  result.cwd = value;
  return 2;
};

const setCommandTimeout: FlagHandler = ({ result, value }) => {
  result.timeout = parseInt(value ?? "", 10);
  return 2;
};

const showHelp: FlagHandler = () => {
  printHelp();
  process.exit(0);
};

const FLAGS: Record<string, FlagHandler> = {
  "--config": setConfig,
  "--cwd": setCwd,
  "--timeout": setCommandTimeout,
  "--help": showHelp,
  "-h": showHelp,
};

/** An argument that is not a flag, or a flag this version does not know, is skipped. */
const skip: FlagHandler = () => 1;

function flagFor(arg: string): FlagHandler {
  return Object.hasOwn(FLAGS, arg) ? FLAGS[arg] : skip;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  let i = 0;
  while (i < args.length) {
    i += flagFor(args[i])({ result, value: args[i + 1] });
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
