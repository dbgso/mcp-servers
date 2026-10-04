/**
 * Arguments of a tool that publishes no argument types, turned back into the
 * types its handler expects.
 *
 * `policy__mcp-tool-surface`: a tool's inputSchema names no argument
 * (`z.object({}).passthrough()`); `describe` says what each action takes. The
 * client converts a tool call's arguments using that inputSchema, so for an
 * argument it has no type for, it sends the value as a string. Claude Code sends
 * `recursive: true` as `"true"`, `depth: 2` as `"2"` and `whenToUse: ["a"]` as
 * `'["a"]'` -- however exactly the model followed `describe`. A strict
 * `z.boolean()` / `z.number()` / `z.array()` in the handler then rejects a
 * documented call: `list(recursive: true)` failed, and `add`, whose `whenToUse`
 * is required, could not be called at all.
 *
 * So every handler behind such a tool wraps those schemas here
 * (`custom/no-strict-scalar-in-untyped-args` checks it). The wrappers accept the
 * string form and nothing looser: `"yes"` or `"1"` for a boolean is still an
 * error, and a string that is not a JSON array stays a string for the array
 * schema to reject.
 */

import { z } from "zod";

function booleanFromString(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

/** A plain decimal: `"2"`, `"1.5"`, `"-3"`. Not `""`, `"0x10"` or `"1e3"`. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

function numberFromString(value: unknown): unknown {
  if (typeof value === "string" && DECIMAL.test(value)) return Number(value);
  return value;
}

/** A JSON array in a string: `'["a","b"]'`. Anything else is left for the schema to judge. */
function arrayFromString(value: unknown): unknown {
  if (typeof value !== "string" || !value.trimStart().startsWith("[")) return value;
  return parseJsonArray(value);
}

function parseJsonArray(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** `z.boolean()` that also takes `"true"` and `"false"`. */
export function looseBoolean<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(booleanFromString, schema);
}

/** `z.number()` that also takes a numeric string such as `"2"`. */
export function looseNumber<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(numberFromString, schema);
}

/** `z.array()` that also takes the array as a JSON string, such as `'["a","b"]'`. */
export function looseArray<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(arrayFromString, schema);
}
