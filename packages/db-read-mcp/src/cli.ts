/**
 * CLI argument parser for `db-read-mcp`.
 *
 * Pure: takes argv (typically `process.argv.slice(2)`), returns a structured
 * options bag. No process-level mutation, no I/O — easy to unit-test.
 */

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

interface PartialCliArgs {
  envFile?: string;
  metadata?: string;
  selectableFields?: string;
  toolPrefix?: string;
}

interface FlagSpec {
  /** CLI flag, e.g. "--env-file". */
  flag: string;
  /** Where the value is stored on the partial args bag. */
  key: keyof PartialCliArgs;
}

const FLAG_SPECS: readonly FlagSpec[] = [
  { flag: "--env-file", key: "envFile" },
  { flag: "--metadata", key: "metadata" },
  { flag: "--selectable-fields", key: "selectableFields" },
  { flag: "--tool-prefix", key: "toolPrefix" },
] as const;

const FLAG_INDEX: ReadonlyMap<string, FlagSpec> = new Map(
  FLAG_SPECS.map((s) => [s.flag, s] as const),
);

const REQUIRED: readonly (keyof CliArgs)[] = [
  "envFile",
  "metadata",
  "selectableFields",
] as const;

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
  const out: PartialCliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === undefined) continue;
    const spec = FLAG_INDEX.get(flag);
    if (!spec) continue;
    const next = argv[i + 1];
    if (next === undefined) {
      throw new Error(`${spec.flag} requires a path argument`);
    }
    out[spec.key] = next;
    i++;
  }
  for (const key of REQUIRED) {
    if (out[key] === undefined) {
      const spec = FLAG_SPECS.find((s) => s.key === key);
      // FLAG_SPECS includes every entry from REQUIRED by construction; the
      // null fallback exists purely to satisfy strict null checks without a
      // non-null assertion.
      const flag = spec?.flag ?? `--${String(key)}`;
      throw new Error(`${flag} is required`);
    }
  }
  // Type narrowing: required keys verified above.
  return out as CliArgs;
}
