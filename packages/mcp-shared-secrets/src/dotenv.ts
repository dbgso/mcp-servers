import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Parse a dotenv file and merge into process.env.
 *
 * Existing process.env values take precedence (so you can override via shell).
 * Returns the parsed map for callers that want to inspect it.
 *
 * Path expansion:
 *   - `~`        → home directory
 *   - `~/foo/bar` → `<home>/foo/bar`
 *   - everything else is passed through unchanged
 */
export function loadEnvFile(filePath: string): Record<string, string> {
  const expanded = expandHome(filePath);

  if (!existsSync(expanded)) {
    throw new Error(`Env file not found: ${expanded}`);
  }

  const source = readFileSync(expanded, "utf8");
  const parsed = parseDotenv(source);
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
  return parsed;
}

/** Expand a leading `~` to the current user's home directory. */
function expandHome(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}

/**
 * Pure dotenv parser. Skips blank lines and `#` comment lines, supports
 * single/double quoted values, escapes (`\n`, `\"`) inside double quotes,
 * and strips trailing inline `# comment` from unquoted values.
 */
function parseDotenv(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    out[key] = unquote(rawValue);
  }
  return out;
}

/**
 * Strip surrounding quotes (or trailing inline comment for bare values).
 * Pure helper — no I/O, no env access.
 */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  // Strip trailing inline comment: any whitespace + `#` to end-of-line.
  return value.replace(/\s+#.*$/, "");
}
