import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { parseCommandArgs } from "./executor.js";
import type { ExecutionResult } from "./types.js";

export type OptionValue = string | boolean | string[];

/** A text-only tool result, the shape every tool here returns. */
export type TextResult = CallToolResult & {
  content: { type: "text"; text: string }[];
};

/** Positional arguments as given: a string is split like a shell would. */
export function toArgsArray(args: string | string[] | undefined): string[] {
  if (args === undefined) return [];
  return typeof args === "string" ? parseCommandArgs(args) : args;
}

/** `-k` for a one-letter key, `--key` otherwise. */
function optionName(key: string): string {
  return key.length === 1 ? `-${key}` : `--${key}`;
}

/**
 * One option as flags: `true` is a bare flag, `false` is left off, and each
 * string (one, or each of a list) follows its own copy of the flag.
 */
function optionToArgs([key, value]: [string, OptionValue]): string[] {
  const name = optionName(key);
  if (typeof value === "boolean") return value ? [name] : [];
  return [value].flat().flatMap((v) => [name, v]);
}

/** Every option as flags, in the order given. */
export function optionsToArgs(options: Record<string, OptionValue> | undefined): string[] {
  return Object.entries(options ?? {}).flatMap(optionToArgs);
}

/** The command line, its output, stderr under its own heading, then the exit code. */
export function formatExecution(result: ExecutionResult): TextResult {
  const output = [`$ ${result.command} ${result.args.join(" ")}`, "", result.stdout];
  if (result.stderr) {
    output.push("", "--- stderr ---", result.stderr);
  }
  output.push("", `[Exit code: ${result.exitCode}, Duration: ${result.duration}ms]`);

  const formatted: TextResult = { content: [{ type: "text", text: output.join("\n") }] };
  if (result.exitCode !== 0) formatted.isError = true;
  return formatted;
}

/** A command that could not be run at all. */
export function errorResult(error: unknown): TextResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `[ERROR] ${message}` }], isError: true };
}
