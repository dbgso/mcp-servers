#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";
import type { CliArgs, TargetConfig } from "./types.js";
import { ProxyConfigSchema } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PRESETS_DIR = resolve(__dirname, "..", "presets");

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
      case "--preset":
        result.preset = nextArg;
        i++;
        break;
      case "--list-presets":
        result.listPresets = true;
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
  mcp-proxy-mcp --command <cmd> --args <arg1> <arg2> ... --preset <name>
  mcp-proxy-mcp --config <path>

Options:
  --command       Command to execute the target MCP server
  --args          Arguments for the target MCP server command
  --rules-file    Path to the rules JSON file
  --preset        Use a preset rule set (e.g., playwright-safe, cli-git-safe)
  --list-presets  List available presets
  --config        Path to the proxy configuration file
  --dry-run       Log blocked calls but don't actually block them
  --audit-log     Path to audit log file (JSON Lines format)
  --help          Show this help message

Examples:
  # Using CLI arguments with rules file
  mcp-proxy-mcp --command npx --args @anthropic/mcp-playwright --rules-file ./rules.json

  # Using a preset
  mcp-proxy-mcp --command npx --args @anthropic/mcp-playwright --preset playwright-safe

  # Using config file
  mcp-proxy-mcp --config ./proxy-config.json

  # Dry-run mode (test rules without blocking)
  mcp-proxy-mcp --config ./proxy-config.json --dry-run

  # List available presets
  mcp-proxy-mcp --list-presets
`);
}

interface PresetInfo {
  name: string;
  description: string;
  rulesCount: number;
  path: string;
}

function listPresets(): PresetInfo[] {
  if (!existsSync(PRESETS_DIR)) {
    return [];
  }

  const files = readdirSync(PRESETS_DIR).filter((f) => f.endsWith(".json"));
  const presets: PresetInfo[] = [];

  for (const file of files) {
    const path = join(PRESETS_DIR, file);
    try {
      const content = JSON.parse(readFileSync(path, "utf-8"));
      presets.push({
        name: content.name ?? file.replace(".json", ""),
        description: content.description ?? "(no description)",
        rulesCount: content.rules?.length ?? 0,
        path,
      });
    } catch {
      // Skip invalid JSON files
    }
  }

  return presets;
}

function printPresets(): void {
  const presets = listPresets();

  if (presets.length === 0) {
    console.log("No presets found.");
    return;
  }

  console.log("Available presets:\n");
  for (const preset of presets) {
    console.log(`  ${preset.name}`);
    console.log(`    ${preset.description}`);
    console.log(`    Rules: ${preset.rulesCount}`);
    console.log();
  }
}

function resolvePresetPath(presetName: string): string {
  // Check if it's a path to a file
  if (existsSync(presetName)) {
    return resolve(presetName);
  }

  // Check in presets directory
  const presetPath = join(PRESETS_DIR, `${presetName}.json`);
  if (existsSync(presetPath)) {
    return presetPath;
  }

  // Check without .json extension
  const presetPathWithExt = join(PRESETS_DIR, presetName);
  if (existsSync(presetPathWithExt)) {
    return presetPathWithExt;
  }

  throw new Error(`Preset not found: ${presetName}\nRun --list-presets to see available presets.`);
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

  // Determine rules file: --rules-file or --preset
  let rulesFile: string;
  if (cliArgs.rulesFile) {
    rulesFile = resolve(cliArgs.rulesFile);
  } else if (cliArgs.preset) {
    rulesFile = resolvePresetPath(cliArgs.preset);
  } else {
    console.error("Error: --rules-file or --preset is required (or use --config)");
    process.exit(1);
  }

  return {
    target: {
      command: cliArgs.command,
      args: cliArgs.args,
    },
    rulesFile,
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

  // Handle --list-presets
  if (cliArgs.listPresets) {
    printPresets();
    process.exit(0);
  }

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
