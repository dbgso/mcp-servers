/**
 * Thin wrapper over the `aws` CLI invoked through `child_process.execFile`.
 *
 * We deliberately do **not** depend on `@aws-sdk/*`:
 *   - SDK install is tens of MB; the CLI is a single binary already on most ops boxes.
 *   - Authentication (SSO, profiles, IAM role chaining) is delegated to the CLI's config.
 *   - Version management is the user's responsibility.
 *
 * The CLI binary itself is a runtime requirement of the user's environment; we
 * surface a friendly error when it is missing.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Signature compatible with `child_process.execFile` (callback form). */
export type ExecFileFn = typeof execFile;

export interface AwsExecOptions {
  /** `--profile` value injected before the command-specific args. */
  profile?: string;
  /** `--region` value injected before the command-specific args. */
  region?: string;
  /** Override the binary name. Default: `"aws"`. Used only by tests. */
  command?: string;
  /** Inject a custom `execFile` implementation. Used only by tests. */
  spawnFn?: ExecFileFn;
}

/** Result shape returned by the promisified `execFile` (subset we use). */
interface ExecFileResult {
  stdout: string;
  stderr: string;
}

/**
 * Build the argv vector for `aws`, prefixing global flags (`--profile`, `--region`)
 * before the command-specific args. Pure — exposed for testability.
 */
export function buildAwsArgs(params: {
  args: readonly string[];
  options?: AwsExecOptions;
}): string[] {
  const out: string[] = [];
  if (params.options?.profile) {
    out.push("--profile", params.options.profile);
  }
  if (params.options?.region) {
    out.push("--region", params.options.region);
  }
  out.push(...params.args);
  return out;
}

/**
 * Run an `aws` CLI command and return trimmed stdout.
 *
 * Errors are normalised by {@link translateAwsError}:
 *   - `ENOENT` → "aws CLI not found" with install URL
 *   - SSO expiry stderr → "AWS SSO session expired" with `aws sso login` hint
 *   - Otherwise → original message + stderr/stdout for diagnostics
 */
export async function awsExec(params: {
  args: readonly string[];
  options?: AwsExecOptions;
}): Promise<string> {
  const command = params.options?.command ?? "aws";
  const finalArgs = buildAwsArgs({ args: params.args, options: params.options });
  const exec = wrapExecFile(params.options?.spawnFn);

  try {
    const { stdout } = await exec({ command, args: finalArgs });
    return stdout.trim();
  } catch (err) {
    throw translateAwsError(err);
  }
}

/**
 * Wrap an injected `execFile` (callback-style) into a promise returning
 * `{ stdout, stderr }`. When no override is given, fall back to the
 * pre-promisified default.
 */
function wrapExecFile(
  spawnFn: ExecFileFn | undefined,
): (params: { command: string; args: readonly string[] }) => Promise<ExecFileResult> {
  if (!spawnFn) {
    return ({ command, args }) =>
      execFileAsync(command, [...args], {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      }) as Promise<ExecFileResult>;
  }
  return ({ command, args }) =>
    new Promise((resolve, reject) => {
      spawnFn(
        command,
        [...args],
        { timeout: 15_000, maxBuffer: 1024 * 1024 },
        // Node's execFile callback signature is fixed at (err, stdout, stderr).
        // eslint-disable-next-line custom/single-params-object
        (err, stdout, stderr) => {
          const stdoutStr = bufferToString(stdout);
          const stderrStr = bufferToString(stderr);
          if (err) {
            // Attach stdout/stderr to the error so translateAwsError can read them.
            const errWithIo = err as Error & { stdout?: string; stderr?: string };
            errWithIo.stdout = stdoutStr;
            errWithIo.stderr = stderrStr;
            reject(errWithIo);
            return;
          }
          resolve({ stdout: stdoutStr, stderr: stderrStr });
        },
      );
    });
}

function bufferToString(value: string | Buffer | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.toString("utf8");
}

/**
 * Convert an arbitrary error from `execFile` into a human-readable Error.
 * Pure — exported for testing.
 */
export function translateAwsError(err: unknown): Error {
  if (!(err instanceof Error)) {
    return new Error(String(err));
  }

  const stderr = readField({ err, key: "stderr" });
  const stdout = readField({ err, key: "stdout" });
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;

  if (code === "ENOENT") {
    return new Error(
      "`aws` CLI not found. Install it from https://aws.amazon.com/cli/ and ensure it is on PATH.",
    );
  }

  if (isSsoExpiryStderr(stderr)) {
    return new Error(
      `AWS SSO session expired. Run \`aws sso login\` (or with --profile) and retry.\n\nOriginal: ${stderr.trim()}`,
    );
  }

  return new Error(
    `aws CLI failed: ${err.message}\nstderr: ${stderr.trim()}\nstdout: ${stdout.trim()}`,
  );
}

/** Read an optional string-ish field off an error object. */
function readField(params: { err: Error; key: "stdout" | "stderr" }): string {
  if (!(params.key in params.err)) return "";
  const v = (params.err as unknown as Record<string, unknown>)[params.key];
  return v === undefined || v === null ? "" : String(v);
}

/**
 * Detect AWS SSO session-expiry signatures in stderr.
 *
 * Covers the three signatures the CLI emits in practice:
 *   - `Error loading SSO Token: Token has expired ...` (boto SSO provider)
 *   - `The SSO session associated with this profile has expired ...`
 *   - `InvalidGrantException` (raw token endpoint failure)
 */
function isSsoExpiryStderr(stderr: string): boolean {
  return /Token has expired|sso session.*expired|InvalidGrant/i.test(stderr);
}
