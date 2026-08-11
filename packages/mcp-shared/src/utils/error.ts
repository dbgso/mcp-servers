/**
 * Error handling utilities.
 *
 * Provides polymorphic error message extraction without instanceof checks.
 */

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
  if (error === null || error === undefined) {
    return "Unknown error";
  }

  // Duck typing: check for message property
  if (
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  // Fallback to string conversion
  return String(error);
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
