/**
 * Error handling utilities.
 *
 * Provides polymorphic error message extraction without instanceof checks.
 */

/** `null` and `undefined` stringify to "null"/"undefined", which tells a reader nothing. */
function isNullish(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * Duck typing rather than `instanceof`: an error that crossed a realm boundary,
 * or came from a second copy of a library, fails `instanceof Error` while still
 * carrying a usable message. `in` throws on a primitive, so the object check
 * has to come first.
 */
function messageOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  return readMessage(error);
}

function readMessage(error: object): string | undefined {
  if (!("message" in error)) return undefined;
  const { message } = error;
  if (typeof message !== "string") return undefined;
  return message;
}

/**
 * Extract error message from unknown error value.
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   return errorResponse(getErrorMessage(error));
 * }
 * ```
 */
export function getErrorMessage(error: unknown): string {
  if (isNullish(error)) {
    return "Unknown error";
  }
  return messageOf(error) ?? String(error);
}

/**
 * Wrap an error with additional context.
 *
 * @example
 * ```typescript
 * catch (error) {
 *   return errorResponse(wrapError({ context: "Failed to read file", error }));
 * }
 * ```
 */
export function wrapError(params: { context: string; error: unknown }): string {
  const { context, error } = params;
  return `${context}: ${getErrorMessage(error)}`;
}
