import type { SecretSource } from "../source.js";
import { awsExec, type AwsExecOptions } from "./aws-exec.js";

/**
 * Build a `SecretSource` for `ssm:<param-name>` URIs.
 *
 * Wraps:
 *   `aws ssm get-parameter --name <path> --with-decryption \
 *        --query Parameter.Value --output text`
 *
 * Returns `undefined` when the parameter is absent (`ParameterNotFound`); any
 * other CLI failure propagates as an Error (already normalised by `awsExec`).
 */
export function ssmSource(options: AwsExecOptions = {}): SecretSource {
  return new SsmSource(options);
}

/** {@link SecretSource} backed by the AWS CLI — see {@link ssmSource}. */
export class SsmSource implements SecretSource {
  constructor(private readonly options: AwsExecOptions = {}) {}

  fetch = async (path: string): Promise<string | undefined> => {
    try {
      return await awsExec({
        args: [
          "ssm",
          "get-parameter",
          "--name",
          path,
          "--with-decryption",
          "--query",
          "Parameter.Value",
          "--output",
          "text",
        ],
        options: this.options,
      });
    } catch (err) {
      if (isParameterNotFound(err)) {
        return undefined;
      }
      throw err;
    }
  };
}

function isParameterNotFound(err: unknown): boolean {
  return err instanceof Error && /ParameterNotFound/.test(err.message);
}
