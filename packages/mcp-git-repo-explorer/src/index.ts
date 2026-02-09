#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { DefaultGitExecutor } from "./services/git-executor.js";
import { DefaultRepositoryManager } from "./services/repository-manager.js";
import type { ReminderConfig } from "./types/index.js";

function parseArgs(params: { args: string[] }): {
  baseDir: string;
  config: ReminderConfig;
} {
  const { args } = params;

  let baseDir = `/tmp/mcp-git-${randomUUID().slice(0, 8)}`;
  const config: ReminderConfig = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--base-dir" && args[i + 1]) {
      baseDir = args[++i];
    } else if (arg === "--remind-mcp") {
      config.remindMcp = true;
    } else if (arg === "--remind-org" && args[i + 1]) {
      config.remindOrg = args[++i];
    } else if (arg === "--remind-task" && args[i + 1]) {
      config.remindTask = args[++i];
    } else if (arg === "--remind-task-ttl" && args[i + 1]) {
      config.remindTaskTtl = parseInt(args[++i], 10);
    } else if (!arg.startsWith("-")) {
      baseDir = arg;
    }
  }

  return { baseDir, config };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { baseDir, config } = parseArgs({ args });

  const executor = new DefaultGitExecutor();
  const repoManager = new DefaultRepositoryManager({
    baseDir,
    executor,
  });

  const context = { executor, repoManager };
  const server = createServer({ context, config });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(`mcp-git-repo-explorer started. Base dir: ${baseDir}\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
