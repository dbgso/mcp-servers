/**
 * Booleans and numbers that also accept their string spelling.
 *
 * `instruction` advertises no arguments in its input schema on purpose --
 * `describe` is where they are written down. The cost is that a client has no
 * type to serialise against, so `recursive: true` can arrive as `"true"` and
 * `depth: 2` as `"2"`. A strict `z.boolean()` then rejects a call made exactly
 * as `describe` shows it. These accept the string form and nothing looser:
 * `"yes"` or `"1"` for a boolean is still an error.
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

/** `z.boolean()` that also takes `"true"` and `"false"`. */
export function looseBoolean<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(booleanFromString, schema);
}

/** `z.number()` that also takes a numeric string such as `"2"`. */
export function looseNumber<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(numberFromString, schema);
}
