import { z } from "zod";

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * A config field holding a regular expression. Checked when the watch is
 * created, so a typo is an immediate "Invalid config" rather than five failed
 * polls later.
 */
export function regexField(description: string) {
  return z
    .string()
    .refine(isValidRegex, { message: "not a valid regular expression" })
    .describe(description);
}
