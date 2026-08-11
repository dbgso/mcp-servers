import { describe, it, expect } from "vitest";
import { ssmSource } from "../../aws/ssm.js";
import type { ExecFileFn } from "../../aws/aws-exec.js";

function makeExecFile(result: {
  err?: NodeJS.ErrnoException & { stdout?: string; stderr?: string };
  stdout?: string;
  stderr?: string;
}): { fn: ExecFileFn; calls: Array<{ command: string; args: readonly string[] }> } {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const fn = ((command: string, args: readonly string[], _opts: unknown, cb: unknown) => {
    calls.push({ command, args });
    const callback = cb as (e: Error | null, o: string, er: string) => void;
    const stdout = result.stdout ?? result.err?.stdout ?? "";
    const stderr = result.stderr ?? result.err?.stderr ?? "";
    if (result.err) {
      callback(result.err, stdout, stderr);
    } else {
      callback(null, stdout, stderr);
    }
    return undefined as unknown as ReturnType<ExecFileFn>;
  }) as unknown as ExecFileFn;
  return { fn, calls };
}

// The happy path (fetch returns the value) and argv construction are covered
// against the real emulator in ssm.floci.test.ts and by the pure buildAwsArgs
// tests in aws-exec.test.ts. What remains here is error handling: injecting
// specific CLI failures that floci cannot be made to emit on demand.
describe("ssmSource — error handling", () => {
  it.each([
    {
      description: "ParameterNotFound",
      stderr:
        "An error occurred (ParameterNotFound) when calling the GetParameter operation",
    },
  ])("returns undefined when the parameter is missing: $description", async ({ stderr }) => {
    const err = Object.assign(new Error("Command failed"), { code: 255 }) as Error & {
      stderr?: string;
    };
    err.stderr = stderr;
    const { fn } = makeExecFile({ err: err as NodeJS.ErrnoException });
    const src = ssmSource({ spawnFn: fn });
    await expect(src.fetch("/missing")).resolves.toBeUndefined();
  });

  it("propagates non-NotFound errors", async () => {
    const err = Object.assign(new Error("Command failed"), { code: 1 }) as Error & {
      stderr?: string;
    };
    err.stderr = "An error occurred (AccessDenied): not allowed";
    const { fn } = makeExecFile({ err: err as NodeJS.ErrnoException });
    const src = ssmSource({ spawnFn: fn });
    await expect(src.fetch("/forbidden")).rejects.toThrow(/AccessDenied/);
  });

  it("constructs with no options object (defaults applied)", () => {
    // Guards the `options = {}` default — no-arg construction must not throw.
    // The real fetch path (default execFile -> aws CLI) is covered against the
    // floci emulator in ssm.floci.test.ts, not by hitting real AWS here.
    const src = ssmSource();
    expect(typeof src.fetch).toBe("function");
  });
});
