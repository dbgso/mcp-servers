/**
 * Text for a value whose type is not known, such as a cell in a table built
 * from arbitrary records.
 *
 * `String(value)` turns an object into "[object Object]", which tells a reader
 * nothing; the markdown and asciidoc table writers and the duckdb loader all did
 * that. Here an object or array becomes its JSON, and a missing value becomes
 * an empty cell.
 */

/** The primitives whose `toString()` is what a reader expects to see. */
function isPrintable(value: unknown): value is number | boolean | bigint {
  return ["number", "boolean", "bigint"].includes(typeof value);
}

function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  return isPrintable(value) ? value.toString() : "";
}

/**
 * Strings as they are, numbers / booleans / bigints via `toString()`, objects
 * and arrays as JSON, and `null`, `undefined`, symbols and functions as "".
 */
export function displayText(value: unknown): string {
  if (typeof value === "object") return value === null ? "" : JSON.stringify(value);
  return scalarText(value);
}
