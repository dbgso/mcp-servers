import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli.js";

describe("parseArgs", () => {
  it.each([
    { name: "empty argv", argv: [], expected: {} },
    { name: "single unknown flag", argv: ["--unknown"], expected: {} },
    {
      name: "--env-file with path",
      argv: ["--env-file", "/tmp/foo.env"],
      expected: { envFile: "/tmp/foo.env" },
    },
    {
      name: "--env-file followed by other flags",
      argv: ["--env-file", "~/.dbgen.env", "--other"],
      expected: { envFile: "~/.dbgen.env" },
    },
    {
      name: "unknown flag before --env-file",
      argv: ["--debug", "--env-file", "./e.env"],
      expected: { envFile: "./e.env" },
    },
  ])("parses $name", ({ argv, expected }) => {
    expect(parseArgs(argv)).toEqual(expected);
  });

  it("throws when --env-file lacks an argument", () => {
    expect(() => parseArgs(["--env-file"])).toThrow(/requires a path/);
  });

  it("uses the last --env-file when repeated", () => {
    expect(parseArgs(["--env-file", "a", "--env-file", "b"])).toEqual({
      envFile: "b",
    });
  });
});
