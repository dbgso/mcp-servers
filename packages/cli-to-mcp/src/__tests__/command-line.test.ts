import { describe, it, expect } from "vitest";
import { errorResult, formatExecution, optionsToArgs, toArgsArray } from "../command-line.js";
import type { ExecutionResult } from "../types.js";

describe("toArgsArray", () => {
  it.each([
    { name: "nothing given", args: undefined, expected: [] },
    { name: "a string is split like a shell", args: `cp "a b" c`, expected: ["cp", "a b", "c"] },
    { name: "an array is taken as is", args: ["a b", "c"], expected: ["a b", "c"] },
  ])("$name", ({ args, expected }) => {
    expect(toArgsArray(args)).toEqual(expected);
  });
});

describe("optionsToArgs", () => {
  it.each([
    { name: "no options", options: undefined, expected: [] },
    { name: "a long string option", options: { profile: "dev" }, expected: ["--profile", "dev"] },
    { name: "a one-letter option", options: { v: "2" }, expected: ["-v", "2"] },
    { name: "a true flag", options: { force: true }, expected: ["--force"] },
    { name: "a false flag is left off", options: { force: false }, expected: [] },
    { name: "a list repeats the flag", options: { tag: ["a", "b"] }, expected: ["--tag", "a", "--tag", "b"] },
    {
      name: "several options keep their order",
      options: { a: "1", force: true, b: ["2"] },
      expected: ["-a", "1", "--force", "-b", "2"],
    },
  ])("$name", ({ options, expected }) => {
    expect(optionsToArgs(options)).toEqual(expected);
  });
});

describe("formatExecution", () => {
  const base: ExecutionResult = {
    command: "echo",
    args: ["hi"],
    stdout: "hi\n",
    stderr: "",
    exitCode: 0,
    duration: 5,
  };

  it("shows the command line, the output and the exit code, and is not an error", () => {
    expect(formatExecution(base)).toEqual({
      content: [{ type: "text", text: "$ echo hi\n\nhi\n\n\n[Exit code: 0, Duration: 5ms]" }],
    });
  });

  it("adds stderr under its own heading and marks a non-zero exit as an error", () => {
    const result = formatExecution({ ...base, stderr: "boom", exitCode: 2 });

    expect(result.content[0].text).toContain("--- stderr ---\nboom");
    expect(result.content[0].text).toContain("[Exit code: 2,");
    expect(result.isError).toBe(true);
  });
});

describe("errorResult", () => {
  it.each([
    { name: "an Error by its message", error: new Error("nope"), text: "[ERROR] nope" },
    { name: "anything else as a string", error: 42, text: "[ERROR] 42" },
  ])("reports $name", ({ error, text }) => {
    expect(errorResult(error)).toEqual({ content: [{ type: "text", text }], isError: true });
  });
});
