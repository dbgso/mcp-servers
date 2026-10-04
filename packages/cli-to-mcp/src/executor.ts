import { spawn } from "node:child_process";
import type { ServerConfig, ExecutionResult } from "./types.js";

/**
 * Execute a CLI command
 */
export async function executeCommand(params: {
  command: string;
  args: string[];
  config?: ServerConfig;
}): Promise<ExecutionResult> {
  const { command, args, config = {} } = params;
  const startTime = Date.now();
  const timeout = config.timeout ?? 30000;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        command,
        args,
        duration: Date.now() - startTime,
      });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

type Quote = '"' | "'";
/** The quote the parser is inside, or "" when unquoted. */
type QuoteState = Quote | "";

const QUOTES: ReadonlySet<string> = new Set<Quote>(['"', "'"]);
const isQuote = (char: string): char is Quote => QUOTES.has(char);
const WHITESPACE = /\s/;

/**
 * The characters a backslash escapes inside each kind of quote, as in a POSIX
 * shell. Outside quotes it escapes any character.
 */
const ESCAPABLE_INSIDE: Record<Quote, ReadonlySet<string>> = {
  '"': new Set(['"', "\\"]),
  "'": new Set(),
};

/**
 * Parse command string into args array, the way a POSIX shell splits words:
 * whitespace separates arguments, single quotes keep everything literally,
 * double quotes keep everything but `\"` and `\\`, and outside quotes a
 * backslash makes the next character literal. An empty quoted string is an
 * empty argument.
 */
export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  // Tracked apart from `current` so that `""` still yields an argument
  let inWord = false;
  let quote: QuoteState = "";

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    const next = argsString[i + 1];

    if (char === "\\" && next !== undefined && (!quote || ESCAPABLE_INSIDE[quote].has(next))) {
      current += next;
      inWord = true;
      i++;
      continue;
    }

    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }

    if (isQuote(char)) {
      quote = char;
      inWord = true;
      continue;
    }

    if (WHITESPACE.test(char)) {
      if (inWord) args.push(current);
      current = "";
      inWord = false;
      continue;
    }

    current += char;
    inWord = true;
  }

  if (inWord) {
    args.push(current);
  }

  return args;
}
