/**
 * The `--flag <value>` argv reader the DB servers share. Each server keeps its
 * own CliArgs type and flag list; the loop, the "requires a path argument"
 * error and the required-flag check are here once.
 */

export interface FlagSpec<K extends string> {
  /** CLI flag, e.g. "--env-file". */
  flag: string;
  /** Where the value is stored on the returned bag. */
  key: K;
}

export interface ParseFlagArgsParams<K extends string> {
  argv: readonly string[];
  specs: readonly FlagSpec<K>[];
  /** Keys that must be present; the first missing one throws "<flag> is required". */
  required?: readonly K[];
}

/**
 * Read `--flag <value>` pairs from argv. Unknown arguments are ignored
 * (forward-compatible); a known flag without a value throws.
 */
export function parseFlagArgs<K extends string>(
  params: ParseFlagArgsParams<K>,
): Partial<Record<K, string>> {
  const { argv, specs, required = [] } = params;
  const byFlag = new Map(specs.map((s) => [s.flag, s] as const));
  const out: Partial<Record<K, string>> = {};
  for (let i = 0; i < argv.length; i++) {
    const spec = byFlag.get(argv[i] as string);
    if (!spec) continue;
    const next = argv[i + 1];
    if (next === undefined) {
      throw new Error(`${spec.flag} requires a path argument`);
    }
    out[spec.key] = next;
    i++;
  }
  const missing = required.find((key) => out[key] === undefined);
  if (missing !== undefined) {
    // A required key with no spec is a caller bug; name it as a flag anyway.
    const flag = specs.find((s) => s.key === missing)?.flag ?? `--${missing}`;
    throw new Error(`${flag} is required`);
  }
  return out;
}
