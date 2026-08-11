import type { SecretSource } from "../source.js";
import { awsExec, type AwsExecOptions } from "./aws-exec.js";

/**
 * Build a `SecretSource` for `sm:<secret-id>` URIs.
 *
 * Wraps:
 *   `aws secretsmanager get-secret-value --secret-id <path> \
 *        --query SecretString --output text`
 *
 * The returned `SecretString` may be a raw value or a JSON object. v1 returns
 * it verbatim; callers who need a JSON sub-key can layer their own parsing.
 *
 * Returns `undefined` when the secret is missing (`ResourceNotFoundException`,
 * or the alternative human-readable phrasing the CLI sometimes prints); other
 * errors propagate.
 */
export function secretsManagerSource(options: AwsExecOptions = {}): SecretSource {
  return {
    fetch: async (path) => {
      try {
        return await awsExec({
          args: [
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            path,
            "--query",
            "SecretString",
            "--output",
            "text",
          ],
          options,
        });
      } catch (err) {
        if (isResourceNotFound(err)) {
          return undefined;
        }
        throw err;
      }
    },
  };
}

function isResourceNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    /ResourceNotFoundException|Secrets Manager can't find/i.test(err.message)
  );
}
