/** Split "a.b[0].c" into ["a", "b", "0", "c"]. */
export function parseJsonPath(path: string): string[] {
  return path.match(/[^.[\]]+/g) ?? [];
}

/** Resolve a dot/bracket path against a parsed JSON value; undefined when absent. */
export function resolveJsonPath(params: { value: unknown; path: string }): unknown {
  let current = params.value;
  for (const token of parseJsonPath(params.path)) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

/** Structural equality good enough for JSON values. */
export function jsonEqual(params: { a: unknown; b: unknown }): boolean {
  return JSON.stringify(params.a ?? null) === JSON.stringify(params.b ?? null);
}

/** Parse JSON, returning undefined instead of throwing on malformed input. */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
