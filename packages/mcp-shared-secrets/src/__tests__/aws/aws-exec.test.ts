import { describe, it, expect } from "vitest";
import {
  awsExec,
  buildAwsArgs,
  translateAwsError,
  type AwsExecOptions,
  type ExecFileFn,
} from "../../aws/aws-exec.js";

/**
 * Build a fake `execFile` that records the (command, args) it was called with
 * and dispatches a scripted result. The returned tuple lets tests inspect
 * captured args after the call.
 *
 * The shape mirrors the callback signature `execFile` exposes (Node's typings
 * have multiple overloads; we model the variant used by `awsExec`'s wrapper).
 */
function makeFakeExecFile(result: {
  err?: NodeJS.ErrnoException & { stdout?: string; stderr?: string };
  stdout?: string;
  stderr?: string;
}): { fn: ExecFileFn; calls: Array<{ command: string; args: readonly string[] }> } {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const fn = ((command: string, args: readonly string[], _opts: unknown, cb: unknown) => {
    calls.push({ command, args });
    const callback = cb as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    // When the test scripts an error, inherit its attached stderr/stdout into
    // the callback args so the wrapper sees them (matches real execFile).
    const stdout = result.stdout ?? result.err?.stdout ?? "";
    const stderr = result.stderr ?? result.err?.stderr ?? "";
    if (result.err) {
      callback(result.err, stdout, stderr);
    } else {
      callback(null, stdout, stderr);
    }
    // The real execFile returns a ChildProcess; awsExec ignores it.
    return undefined as unknown as ReturnType<ExecFileFn>;
  }) as unknown as ExecFileFn;
  return { fn, calls };
}

describe("buildAwsArgs", () => {
  it.each([
    {
      description: "no options → args verbatim",
      options: undefined,
      args: ["ssm", "get-parameter", "--name", "/foo"],
      expected: ["ssm", "get-parameter", "--name", "/foo"],
    },
    {
      description: "profile only",
      options: { profile: "myprofile" } satisfies AwsExecOptions,
      args: ["ssm", "get-parameter"],
      expected: ["--profile", "myprofile", "ssm", "get-parameter"],
    },
    {
      description: "region only",
      options: { region: "ap-northeast-1" } satisfies AwsExecOptions,
      args: ["ssm", "get-parameter"],
      expected: ["--region", "ap-northeast-1", "ssm", "get-parameter"],
    },
    {
      description: "profile + region (profile first, then region, then args)",
      options: {
        profile: "myprofile",
        region: "ap-northeast-1",
      } satisfies AwsExecOptions,
      args: ["secretsmanager", "get-secret-value"],
      expected: [
        "--profile",
        "myprofile",
        "--region",
        "ap-northeast-1",
        "secretsmanager",
        "get-secret-value",
      ],
    },
  ])("$description", ({ options, args, expected }) => {
    expect(buildAwsArgs({ args, ...(options ? { options } : {}) })).toEqual(expected);
  });
});

describe("awsExec", () => {
  it("returns trimmed stdout on success", async () => {
    const { fn, calls } = makeFakeExecFile({ stdout: "hello-value\n" });
    const result = await awsExec({
      args: ["ssm", "get-parameter", "--name", "/x"],
      options: { spawnFn: fn },
    });
    expect(result).toBe("hello-value");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("aws");
    expect(calls[0].args).toEqual(["ssm", "get-parameter", "--name", "/x"]);
  });

  it("prefixes profile and region before args", async () => {
    const { fn, calls } = makeFakeExecFile({ stdout: "v" });
    await awsExec({
      args: ["ssm", "get-parameter"],
      options: { spawnFn: fn, profile: "p1", region: "us-east-1" },
    });
    expect(calls[0].args).toEqual([
      "--profile",
      "p1",
      "--region",
      "us-east-1",
      "ssm",
      "get-parameter",
    ]);
  });

  it("respects an injected `command` override", async () => {
    const { fn, calls } = makeFakeExecFile({ stdout: "v" });
    await awsExec({
      args: ["ssm"],
      options: { spawnFn: fn, command: "/usr/local/bin/aws" },
    });
    expect(calls[0].command).toBe("/usr/local/bin/aws");
  });

  it("translates ENOENT into an `aws CLI not found` error", async () => {
    const enoent: NodeJS.ErrnoException = Object.assign(new Error("spawn aws ENOENT"), {
      code: "ENOENT",
    });
    const { fn } = makeFakeExecFile({ err: enoent });
    await expect(
      awsExec({ args: ["ssm"], options: { spawnFn: fn } }),
    ).rejects.toThrow(/aws.*CLI not found/i);
  });

  it.each([
    {
      description: "Token has expired",
      stderr: "Error loading SSO Token: Token has expired and refresh failed",
    },
    {
      description: "SSO session has expired",
      stderr: "The SSO session associated with this profile has expired",
    },
    {
      description: "InvalidGrant",
      stderr: "An error occurred (InvalidGrantException) when calling CreateToken",
    },
  ])("relays SSO expiry stderr: $description", async ({ stderr }) => {
    const err = Object.assign(new Error("Command failed"), { code: 255 }) as Error & {
      stderr?: string;
    };
    err.stderr = stderr;
    const { fn } = makeFakeExecFile({ err: err as NodeJS.ErrnoException });
    await expect(awsExec({ args: ["ssm"], options: { spawnFn: fn } })).rejects.toThrow(
      /AWS SSO session expired/,
    );
  });

  it("relays generic CLI errors with stderr/stdout context", async () => {
    const err = Object.assign(new Error("Command failed"), { code: 1 }) as Error & {
      stderr?: string;
      stdout?: string;
    };
    err.stderr = "An error occurred (AccessDenied): not allowed";
    err.stdout = "";
    const { fn } = makeFakeExecFile({ err: err as NodeJS.ErrnoException });
    await expect(awsExec({ args: ["ssm"], options: { spawnFn: fn } })).rejects.toThrow(
      /aws CLI failed.*AccessDenied/s,
    );
  });

  it("forwards Buffer stdout/stderr from the injected execFile", async () => {
    // Some execFile call sites yield Buffers when `encoding: "buffer"` is set.
    // The wrapper should normalise to strings before passing to translateAwsError
    // and before trimming on success.
    const fn = ((
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb: unknown,
    ) => {
      const callback = cb as (
        err: Error | null,
        stdout: Buffer,
        stderr: Buffer,
      ) => void;
      callback(null, Buffer.from("buf-value\n", "utf8"), Buffer.from("", "utf8"));
      return undefined as unknown as ReturnType<ExecFileFn>;
    }) as unknown as ExecFileFn;

    const out = await awsExec({ args: ["ssm"], options: { spawnFn: fn } });
    expect(out).toBe("buf-value");
  });

  it("normalises undefined stdout/stderr from the injected execFile", async () => {
    // Real execFile always passes strings/Buffers, but our wrapper guards
    // against undefined. Exercise that branch directly.
    const fn = ((
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb: unknown,
    ) => {
      const callback = cb as (
        err: Error | null,
        stdout: undefined,
        stderr: undefined,
      ) => void;
      callback(null, undefined, undefined);
      return undefined as unknown as ReturnType<ExecFileFn>;
    }) as unknown as ExecFileFn;
    const out = await awsExec({ args: ["ssm"], options: { spawnFn: fn } });
    expect(out).toBe("");
  });

  it("uses the default execFile path when no spawnFn is provided (sanity)", async () => {
    // We exercise the no-injection branch by calling a binary that is
    // guaranteed missing on PATH. This produces an ENOENT through the *real*
    // execFile path — covering the fallback wrapping.
    await expect(
      awsExec({
        args: ["whatever"],
        options: { command: "definitely-not-an-aws-binary-xyz" },
      }),
    ).rejects.toThrow(/aws.*CLI not found/i);
  });
});

describe("translateAwsError", () => {
  it("wraps non-Error throwables in a generic Error", () => {
    expect(translateAwsError("boom").message).toBe("boom");
    expect(translateAwsError(123).message).toBe("123");
  });

  it("handles errors without stderr/stdout fields", () => {
    const out = translateAwsError(new Error("plain"));
    // Falls through to the generic relay branch with empty stderr/stdout.
    expect(out.message).toMatch(/aws CLI failed: plain/);
  });

  it("treats null stderr/stdout fields as empty strings", () => {
    const err = Object.assign(new Error("oops"), {
      stderr: null,
      stdout: null,
      code: 1,
    });
    const out = translateAwsError(err);
    expect(out.message).toMatch(/aws CLI failed: oops/);
  });
});
