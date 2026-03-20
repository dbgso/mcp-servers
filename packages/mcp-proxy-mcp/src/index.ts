#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "./server.js";
import type { CliArgs, TargetConfig } from "./types.js";
import { ProxyConfigSchema } from "./types.js";

// Store cleanup function for signal handling
let cleanup: (() => Promise<void>) | null = null;

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--command":
        result.command = nextArg;
        i++;
        break;
      case "--args":
        // Collect all args until next flag
        result.args = [];
        while (args[i + 1] && !args[i + 1].startsWith("--")) {
          result.args.push(args[++i]);
        }
        break;
      case "--rules-file":
        result.rulesFile = nextArg;
        i++;
        break;
      case "--config":
        result.config = nextArg;
        i++;
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--audit-log":
        result.auditLog = nextArg;
        i++;
        break;
      case "--help":
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
mcp-proxy-mcp - MCP proxy server with rule-based filtering

Usage:
  mcp-proxy-mcp --command <cmd> --args <arg1> <arg2> ... --rules-file <path>
  mcp-proxy-mcp --config <path>

Options:
  --command      Command to execute the target MCP server
  --args         Arguments for the target MCP server command
  --rules-file   Path to the rules JSON file
  --config       Path to the proxy configuration file
  --dry-run      Log blocked calls but don't actually block them
  --audit-log    Path to audit log file (JSON Lines format)
  --help         Show this help message

Examples:
  # Using CLI arguments
  mcp-proxy-mcp --command node --args ./playwright-mcp/dist/index.js --rules-file ./rules.json

  # Using config file
  mcp-proxy-mcp --config ./proxy-config.json

  # Dry-run mode (test rules without blocking)
  mcp-proxy-mcp --config ./proxy-config.json --dry-run
`);
}

function loadConfig(cliArgs: CliArgs): {
  target: TargetConfig;
  rulesFile: string;
  dryRun: boolean;
  auditLog?: string;
} {
  if (cliArgs.config) {
    // Load from config file
    const configPath = resolve(cliArgs.config);
    const configContent = readFileSync(configPath, "utf-8");
    const config = ProxyConfigSchema.parse(JSON.parse(configContent));
    const auditLog = cliArgs.auditLog ?? config.auditLog;
    return {
      target: config.target,
      rulesFile: resolve(config.rulesFile),
      dryRun: cliArgs.dryRun ?? config.dryRun ?? false,
      auditLog: auditLog ? resolve(auditLog) : undefined,
    };
  }

  // Use CLI arguments
  if (!cliArgs.command) {
    console.error("Error: --command is required (or use --config)");
    process.exit(1);
  }

  if (!cliArgs.rulesFile) {
    console.error("Error: --rules-file is required (or use --config)");
    process.exit(1);
  }

  return {
    target: {
      command: cliArgs.command,
      args: cliArgs.args,
    },
    rulesFile: resolve(cliArgs.rulesFile),
    dryRun: cliArgs.dryRun ?? false,
    auditLog: cliArgs.auditLog ? resolve(cliArgs.auditLog) : undefined,
  };
}

// Setup signal handlers for graceful shutdown
function setupSignalHandlers(): void {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

  for (const signal of signals) {
    process.on(signal, async () => {
      console.error(`\n[mcp-proxy] Received ${signal}, shutting down...`);
      if (cleanup) {
        await cleanup();
      }
      process.exit(0);
    });
  }
}

async function main(): Promise<void> {
  setupSignalHandlers();

  const args = process.argv.slice(2);
  const cliArgs = parseArgs(args);
  const { target, rulesFile, dryRun, auditLog } = loadConfig(cliArgs);

  if (dryRun) {
    console.error("[mcp-proxy] Running in DRY-RUN mode - blocked calls will be logged but not blocked");
  }

  if (auditLog) {
    console.error(`[mcp-proxy] Audit logging enabled: ${auditLog}`);
  }

  const { server, proxyClient } = await createServer({ target, rulesFile, dryRun, auditLog });

  // Set cleanup function to disconnect proxy client
  cleanup = async () => {
    await proxyClient.disconnect();
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
