import { describe, it, expect } from "vitest";
import { executeCommand, parseCommandArgs } from "../executor.js";

describe("parseCommandArgs", () => {
  it("should parse simple args", () => {
    expect(parseCommandArgs("s3 ls")).toEqual(["s3", "ls"]);
  });

  it("should handle quoted strings", () => {
    expect(parseCommandArgs('s3 cp "file name.txt" s3://bucket/')).toEqual([
      "s3",
      "cp",
      "file name.txt",
      "s3://bucket/",
    ]);
  });

  it("should handle single quotes", () => {
    expect(parseCommandArgs("echo 'hello world'")).toEqual([
      "echo",
      "hello world",
    ]);
  });

  it("should handle mixed quotes", () => {
    expect(parseCommandArgs(`echo "it's working"`)).toEqual([
      "echo",
      "it's working",
    ]);
  });

  it("should handle empty string", () => {
    expect(parseCommandArgs("")).toEqual([]);
  });

  it("should handle multiple spaces", () => {
    expect(parseCommandArgs("s3   ls   --recursive")).toEqual([
      "s3",
      "ls",
      "--recursive",
    ]);
  });

  it("should handle options with values", () => {
    expect(parseCommandArgs("--profile production --region ap-northeast-1")).toEqual([
      "--profile",
      "production",
      "--region",
      "ap-northeast-1",
    ]);
  });

  it("drops the backslash of an escaped space and keeps the word whole", () => {
    expect(parseCommandArgs("echo hello\\ world")).toEqual(["echo", "hello world"]);
  });

  it("reads an escaped backslash as one literal backslash that escapes nothing", () => {
    // `a\\ b` is `a\` followed by a separate `b`, as in a shell.
    expect(parseCommandArgs("a\\\\ b")).toEqual(["a\\", "b"]);
  });

  it("escapes a quote outside quotes instead of opening a quoted string", () => {
    expect(parseCommandArgs('say \\"hi')).toEqual(["say", '"hi']);
  });

  it("escapes a double quote and a backslash inside double quotes, and nothing else", () => {
    expect(parseCommandArgs('"a\\"b" "c\\\\d" "e\\nf"')).toEqual(['a"b', "c\\d", "e\\nf"]);
  });

  it("keeps backslashes literally inside single quotes", () => {
    expect(parseCommandArgs("'a\\ b'")).toEqual(["a\\ b"]);
  });

  it("keeps a trailing backslash", () => {
    expect(parseCommandArgs("end\\")).toEqual(["end\\"]);
  });

  it("joins quoted and unquoted parts of one word", () => {
    expect(parseCommandArgs(`--name="a b"c`)).toEqual(["--name=a bc"]);
  });

  it("splits on tabs and newlines as well as spaces", () => {
    expect(parseCommandArgs("a\tb\nc")).toEqual(["a", "b", "c"]);
  });

  it("should handle nested quotes", () => {
    expect(parseCommandArgs(`echo "say 'hello'"`)).toEqual([
      "echo",
      "say 'hello'",
    ]);
  });

  it("passes an empty quoted string on as an empty argument", () => {
    expect(parseCommandArgs(`echo "" end ''`)).toEqual(["echo", "", "end", ""]);
  });
});

describe("executeCommand", () => {
  it("should execute simple command", async () => {
    const result = await executeCommand({
      command: "echo",
      args: ["hello"],
      config: { timeout: 5000 },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.command).toBe("echo");
  });

  it("should capture stderr", async () => {
    const result = await executeCommand({
      command: "sh",
      args: ["-c", "echo error >&2"],
      config: { timeout: 5000 },
    });

    expect(result.stderr.trim()).toBe("error");
  });

  it("should return exit code on failure", async () => {
    const result = await executeCommand({
      command: "sh",
      args: ["-c", "exit 42"],
      config: { timeout: 5000 },
    });

    expect(result.exitCode).toBe(42);
  });

  it("should timeout long running commands", async () => {
    await expect(
      executeCommand({
        command: "sleep",
        args: ["10"],
        config: { timeout: 100 },
      })
    ).rejects.toThrow("timed out");
  });

  it("should measure duration", async () => {
    const result = await executeCommand({
      command: "echo",
      args: ["test"],
      config: { timeout: 5000 },
    });

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.duration).toBeLessThan(1000);
  });

  it("should use cwd option", async () => {
    const result = await executeCommand({
      command: "pwd",
      args: [],
      config: { cwd: "/tmp" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("/tmp");
  });

  it("should use env option", async () => {
    const result = await executeCommand({
      command: "sh",
      args: ["-c", "echo $TEST_VAR"],
      config: { env: { TEST_VAR: "hello_from_env" } },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello_from_env");
  });

  it("should reject on spawn error for non-existent command", async () => {
    await expect(
      executeCommand({
        command: "nonexistent-command-12345",
        args: [],
        config: { timeout: 5000 },
      })
    ).rejects.toThrow();
  });
});
