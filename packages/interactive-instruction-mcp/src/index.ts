#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { configureDraftWorkflowPersistence } from "./workflows/draft-workflow.js";
import type { ReminderConfig } from "./types/index.js";
import type { DocumentScope } from "./services/document-scope.js";

interface CliOptions {
  /** `--reminder "message"`, which may appear more than once. */
  customReminders: string[];
  /**
   * Which documents this server manages. A documents directory is not always
   * all one tool's -- see services/document-scope.ts.
   */
  include: string[];
  exclude: string[];
  topicForEveryTask: string | null;
  infoValidSeconds: number;
}

type ValueFlagHandler = (params: { options: CliOptions; value: string }) => void;

const addReminder: ValueFlagHandler = ({ options, value }) => {
  options.customReminders.push(value);
};

const addInclude: ValueFlagHandler = ({ options, value }) => {
  options.include.push(value);
};

const addExclude: ValueFlagHandler = ({ options, value }) => {
  options.exclude.push(value);
};

const setTopicForEveryTask: ValueFlagHandler = ({ options, value }) => {
  options.topicForEveryTask = value;
};

const setInfoValidSeconds: ValueFlagHandler = ({ options, value }) => {
  // An unparseable value falls back to the default rather than becoming NaN.
  options.infoValidSeconds = parseInt(value, 10) || 60;
};

/**
 * The flags that carry a value, and what each one does with it.
 *
 * A table rather than an if-chain because the scanner needs the same knowledge
 * in order to skip a flag's value -- otherwise `--include docs` would also read
 * `docs` as the documents directory. This used to be two loops with their own
 * copy of the list, so a flag added to only the first one silently turned its
 * value into a positional argument.
 */
const VALUE_FLAGS: Record<string, ValueFlagHandler> = {
  "--reminder": addReminder,
  "--include": addInclude,
  "--exclude": addExclude,
  "--topic-for-every-task": setTopicForEveryTask,
  "--info-expires": setInfoValidSeconds,
};

function defaultOptions(): CliOptions {
  return {
    customReminders: [],
    include: [],
    exclude: [],
    topicForEveryTask: null,
    infoValidSeconds: 60,
  };
}

/** A trailing flag with nothing after it is ignored, as it always was. */
function applyValueFlag(params: {
  handler: ValueFlagHandler;
  options: CliOptions;
  value: string | undefined;
}): number {
  const { handler, options, value } = params;
  if (value !== undefined) {
    handler({ options, value });
  }
  return 2;
}

/** How many arguments `args[index]` used up: two for a flag and its value. */
function takeArg(params: {
  args: string[];
  index: number;
  options: CliOptions;
  positional: string[];
}): number {
  const { args, index, options, positional } = params;
  const arg = args[index];

  const handler = VALUE_FLAGS[arg];
  if (handler !== undefined) {
    return applyValueFlag({ handler, options, value: args[index + 1] });
  }

  if (!arg.startsWith("--")) {
    positional.push(arg);
  }
  return 1;
}

function scanArgs(args: string[]): { options: CliOptions; positional: string[] } {
  const options = defaultOptions();
  const positional: string[] = [];

  let index = 0;
  while (index < args.length) {
    index += takeArg({ args, index, options, positional });
  }

  return { options, positional };
}

function parseArgs(params: { args: string[] }): {
  markdownDir: string;
  config: ReminderConfig;
  scope: DocumentScope;
} {
  const { args } = params;
  const { options, positional } = scanArgs(args);

  if (positional.length === 0) {
    console.error(
      "Usage: mcp-interactive-instruction <markdown-directory> [--remind-mcp] [--remind-organize] [--reminder <message>] [--topic-for-every-task <document-id>] [--info-expires <seconds>] [--include <id-prefix>] [--exclude <id-prefix>]..."
    );
    process.exit(1);
  }

  return {
    markdownDir: positional[0],
    config: {
      remindMcp: args.includes("--remind-mcp"),
      remindOrganize: args.includes("--remind-organize"),
      customReminders: options.customReminders,
      topicForEveryTask: options.topicForEveryTask,
      infoValidSeconds: options.infoValidSeconds,
    },
    scope: { include: options.include, exclude: options.exclude },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const { markdownDir, config, scope } = parseArgs({ args });

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
