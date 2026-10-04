/**
 * CLI argument parser for `db-codegen-mcp`.
 *
 * Pure: takes argv (typically `process.argv.slice(2)`), returns a structured
 * options bag. No process-level mutation, no I/O — easy to unit-test.
 */

import { parseFlagArgs, type FlagSpec } from "mcp-shared-db-core";

export interface CliArgs {
  /** Path to a dotenv file to load before resolver construction. */
  envFile?: string;
}

const FLAG_SPECS: readonly FlagSpec<keyof CliArgs>[] = [{ flag: "--env-file", key: "envFile" }];

/**
 * Parse `db-codegen-mcp` CLI args.
 *
 * Currently supports:
 *   --env-file <path>   Load dotenv key/value pairs from <path> at startup.
 *
 * Unknown flags are intentionally ignored (forward-compatible).
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  return parseFlagArgs({ argv, specs: FLAG_SPECS });
}
