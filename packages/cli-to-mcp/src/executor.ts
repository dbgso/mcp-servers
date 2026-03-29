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

/**
 * Parse command string into args array
 * Handles quoted strings and escapes
 */
export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    const prevChar = argsString[i - 1];

    // Handle escape
    if (prevChar === "\\" && !inQuote) {
      current += char;
      continue;
    }

    // Handle quotes
    if ((char === '"' || char === "'") && prevChar !== "\\") {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
        quoteChar = "";
      } else {
        current += char;
      }
      continue;
    }

    // Handle space
    if (char === " " && !inQuote) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }

  return args;
}
