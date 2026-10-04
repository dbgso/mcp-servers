#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import type { ReminderConfig } from "./types/index.js";

interface CliOptions {
  /** `--reminder "message"`, which may appear more than once. */
  customReminders: string[];
  topicForEveryTask: string | null;
  infoValidSeconds: number;
}

type ValueFlagHandler = (params: { options: CliOptions; value: string }) => void;

const addReminder: ValueFlagHandler = ({ options, value }) => {
  options.customReminders.push(value);
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
 * One table, because the scanner needs the same list to skip a flag's value:
 * this used to be two loops with their own copy of it, and a flag added to only
 * the first would have turned its value into the documents directory. Same
 * shape as interactive-instruction-mcp's.
 */
const VALUE_FLAGS: Record<string, ValueFlagHandler> = {
  "--reminder": addReminder,
  "--topic-for-every-task": setTopicForEveryTask,
  "--info-expires": setInfoValidSeconds,
};

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
    // A trailing flag with nothing after it is ignored, as it always was.
    const value = args[index + 1];
    if (value !== undefined) handler({ options, value });
    return 2;
  }

  if (!arg.startsWith("--")) {
    positional.push(arg);
  }
  return 1;
}

function scanArgs(args: string[]): { options: CliOptions; positional: string[] } {
  const options: CliOptions = { customReminders: [], topicForEveryTask: null, infoValidSeconds: 60 };
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
} {
  const { args } = params;
  const { options, positional } = scanArgs(args);

  if (positional.length === 0) {
    console.error(
      "Usage: interactive-pdca-mcp <markdown-directory> [--remind-mcp] [--remind-organize] [--reminder <message>] [--topic-for-every-task <document-id>] [--info-expires <seconds>]..."
    );
    process.exit(1);
  }

  return {
    markdownDir: positional[0],
    config: {
      remindMcp: args.includes("--remind-mcp"),
      remindOrganize: args.includes("--remind-organize"),
      ...options,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const { markdownDir, config } = parseArgs({ args });

  const server = createServer({ markdownDir, config });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
