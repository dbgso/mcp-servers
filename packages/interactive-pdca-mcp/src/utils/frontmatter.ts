/**
 * The front matter both record files are written with, read in one place.
 *
 * Tasks and feedback each had their own copy of the split, the line loop and
 * the quote check, and the copies had drifted: only feedback knew `null`, only
 * tasks knew inline arrays. What differs between the two is how a value is
 * typed, so that is the one thing each caller passes in.
 */

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

const QUOTES = ['"', "'"] as const;

export interface Frontmatter {
  metadata: Record<string, unknown>;
  body: string;
}

/**
 * Split `---` front matter from the body and type each `key: value` line with
 * `parseValue`. Null when the text has no front matter.
 */
export function parseFrontmatter(params: {
  text: string;
  parseValue: (raw: string) => unknown;
}): Frontmatter | null {
  const { text, parseValue } = params;
  const match = text.match(FRONTMATTER);
  if (!match) return null;

  const [, yaml, body] = match;
  const metadata: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    metadata[line.slice(0, colonIndex).trim()] = parseValue(line.slice(colonIndex + 1).trim());
  }
  return { metadata, body };
}

/** The inside of a `"…"` or `'…'` value, or null when it is not quoted. */
export function unquote(value: string): string | null {
  const quoted = QUOTES.some((q) => value.length >= 2 && value.startsWith(q) && value.endsWith(q));
  return quoted ? value.slice(1, -1) : null;
}

/** `[a, "b"]` as its items, or null when the value is not an inline array. */
export function parseInlineArray(value: string): string[] | null {
  if (!value.startsWith("[") || !value.endsWith("]")) return null;
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((item) => {
    const trimmed = item.trim();
    return unquote(trimmed) ?? trimmed;
  });
}

const BOOLEANS: Record<string, boolean> = { true: true, false: false };

/** `true` / `false` as booleans, or undefined for any other value. */
export function parseBoolean(value: string): boolean | undefined {
  return Object.hasOwn(BOOLEANS, value) ? BOOLEANS[value] : undefined;
}
