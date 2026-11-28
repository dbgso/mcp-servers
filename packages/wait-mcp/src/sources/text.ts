/**
 * A field of an API payload as text. Strings, numbers and booleans read as
 * themselves; anything else (missing, null, an object) is `fallback`, rather
 * than "[object Object]".
 */
export function asText(params: { value: unknown; fallback: string }): string {
  const { value, fallback } = params;
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

/** Like {@link asText}, but a field that is not text stays `undefined`. */
export function asOptionalText(value: unknown): string | undefined {
  const text = asText({ value, fallback: "" });
  return text === "" && typeof value !== "string" ? undefined : text;
}
