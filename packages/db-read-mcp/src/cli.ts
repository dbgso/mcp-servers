/**
 * CLI argument parser for `db-read-mcp`.
 *
 * Pure: takes argv (typically `process.argv.slice(2)`), returns a structured
 * options bag. No process-level mutation, no I/O — easy to unit-test.
 */

import { parseFlagArgs, type FlagSpec } from "mcp-shared-db-core";

export interface CliArgs {
  /** Path to a dotenv file to load before resolver construction. Required. */
  envFile: string;
  /**
   * Path to the table metadata. JSON is preferred (works with plain `node`);
   * `.ts` / `.js` files are supported only when a TS-aware loader is active.
   */
  metadata: string;
  /**
   * Path to the selectable-fields whitelist. JSON is preferred (works with
   * plain `node`); `.ts` / `.js` files are supported only when a TS-aware
   * loader is active.
   */
  selectableFields: string;
  /** Override the tool prefix (default: "db"). */
  toolPrefix?: string;
}

const FLAG_SPECS: readonly FlagSpec<keyof CliArgs>[] = [
  { flag: "--env-file", key: "envFile" },
  { flag: "--metadata", key: "metadata" },
  { flag: "--selectable-fields", key: "selectableFields" },
  { flag: "--tool-prefix", key: "toolPrefix" },
];

const REQUIRED: readonly (keyof CliArgs)[] = ["envFile", "metadata", "selectableFields"];

/**
 * Parse db-read-mcp CLI args. Required flags:
 *   --env-file <path>           Dotenv file (loaded before resolver).
 *   --metadata <path>           JSON (preferred) or TS file with `tableMetadata`.
 *   --selectable-fields <path>  JSON (preferred) or TS file with `selectableFields`.
 * Optional:
 *   --tool-prefix <name>        Defaults to "db".
 *
 * Unknown flags are intentionally ignored (forward-compatible).
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  // Type narrowing: parseFlagArgs throws unless every REQUIRED key is present.
  return parseFlagArgs({ argv, specs: FLAG_SPECS, required: REQUIRED }) as CliArgs;
}
