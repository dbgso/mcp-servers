/**
 * CLI argument parser for `db-codegen-mcp`.
 *
 * Pure: takes argv (typically `process.argv.slice(2)`), returns a structured
 * options bag. No process-level mutation, no I/O — easy to unit-test.
 */

export interface CliArgs {
  /** Path to a dotenv file to load before resolver construction. */
  envFile?: string;
}

/**
 * Parse `db-codegen-mcp` CLI args.
 *
 * Currently supports:
 *   --env-file <path>   Load dotenv key/value pairs from <path> at startup.
 *
 * Unknown flags are intentionally ignored (forward-compatible).
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--env-file") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("--env-file requires a path argument");
      }
      out.envFile = next;
      i++;
      continue;
    }
  }
  return out;
}
