#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { ensureSystemDocs } from "./services/system-docs.js";
import { configureDraftWorkflowPersistence } from "./workflows/draft-workflow.js";
import type { ReminderConfig } from "./types/index.js";
import type { DocumentScope } from "./services/document-scope.js";

function parseArgs(params: { args: string[] }): {
  markdownDir: string;
  config: ReminderConfig;
  scope: DocumentScope;
} {
  const { args } = params;
  const remindMcp = args.includes("--remind-mcp");
  const remindOrganize = args.includes("--remind-organize");

  // Parse --reminder "message" flags (can appear multiple times)
  const customReminders: string[] = [];
  // Which documents this server manages. A documents directory is not always
  // all one tool's -- see services/document-scope.ts.
  const include: string[] = [];
  const exclude: string[] = [];
  let topicForEveryTask: string | null = null;
  let infoValidSeconds = 60; // Default: 60 seconds
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--reminder" && i + 1 < args.length) {
      customReminders.push(args[i + 1]);
      i++; // Skip the next arg (the message)
    } else if (args[i] === "--topic-for-every-task" && i + 1 < args.length) {
      topicForEveryTask = args[i + 1];
      i++; // Skip the next arg (the document id)
    } else if (args[i] === "--include" && i + 1 < args.length) {
      include.push(args[i + 1]);
      i++;
    } else if (args[i] === "--exclude" && i + 1 < args.length) {
      exclude.push(args[i + 1]);
      i++;
    } else if (args[i] === "--info-expires" && i + 1 < args.length) {
      infoValidSeconds = parseInt(args[i + 1], 10) || 60;
      i++; // Skip the next arg (the seconds)
    }
  }

  // Filter out flags and their values to get positional args
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (
      args[i] === "--reminder" ||
      args[i] === "--topic-for-every-task" ||
      args[i] === "--info-expires" ||
      args[i] === "--include" ||
      args[i] === "--exclude"
    ) {
      i++; // Skip the value
    } else if (!args[i].startsWith("--")) {
      positional.push(args[i]);
    }
  }

  if (positional.length === 0) {
    console.error(
      "Usage: mcp-interactive-instruction <markdown-directory> [--remind-mcp] [--remind-organize] [--reminder <message>] [--topic-for-every-task <document-id>] [--info-expires <seconds>] [--include <id-prefix>] [--exclude <id-prefix>]..."
    );
    process.exit(1);
  }

  return {
    markdownDir: positional[0],
    config: { remindMcp, remindOrganize, customReminders, topicForEveryTask, infoValidSeconds },
    scope: { include, exclude },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const { markdownDir, config, scope } = parseArgs({ args });

  // Ensure system documentation exists
  await ensureSystemDocs({ docsDir: markdownDir });

  // Keep this server's workflow state apart from any other instance's. Without
  // it they share one store keyed by document id.
  configureDraftWorkflowPersistence({ docsDir: markdownDir });

  const server = createServer({ markdownDir, config, scope });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
