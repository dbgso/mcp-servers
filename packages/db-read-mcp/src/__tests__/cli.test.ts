import { describe, expect, it } from "vitest";
import { parseArgs } from "../cli.js";

const REQUIRED_ARGS = [
  "--env-file",
  "/tmp/foo.env",
  "--metadata",
  "/tmp/m.ts",
  "--selectable-fields",
  "/tmp/s.ts",
];

describe("parseArgs", () => {
  it.each([
    {
      name: "minimal required args",
      argv: REQUIRED_ARGS,
      expected: {
        envFile: "/tmp/foo.env",
        metadata: "/tmp/m.ts",
        selectableFields: "/tmp/s.ts",
      },
    },
    {
      name: "with tool-prefix",
      argv: [...REQUIRED_ARGS, "--tool-prefix", "rds"],
      expected: {
        envFile: "/tmp/foo.env",
        metadata: "/tmp/m.ts",
        selectableFields: "/tmp/s.ts",
        toolPrefix: "rds",
      },
    },
    {
      name: "ignores unknown flags",
      argv: [...REQUIRED_ARGS, "--debug"],
      expected: {
        envFile: "/tmp/foo.env",
        metadata: "/tmp/m.ts",
        selectableFields: "/tmp/s.ts",
      },
    },
    {
      name: "uses last value when a flag is repeated",
      argv: [
        "--env-file",
        "first.env",
        "--env-file",
        "second.env",
        "--metadata",
        "/m.ts",
        "--selectable-fields",
        "/s.ts",
      ],
      expected: {
        envFile: "second.env",
        metadata: "/m.ts",
        selectableFields: "/s.ts",
      },
    },
    {
      name: "interleaved flags + unknown noise",
      argv: [
        "--debug",
        "--env-file",
        "e.env",
        "--unknown",
        "--metadata",
        "m.ts",
        "--selectable-fields",
        "s.ts",
        "--tool-prefix",
        "alt",
      ],
      expected: {
        envFile: "e.env",
        metadata: "m.ts",
        selectableFields: "s.ts",
        toolPrefix: "alt",
      },
    },
  ])("parses $name", ({ argv, expected }) => {
    expect(parseArgs(argv)).toEqual(expected);
  });

  it.each([
    { name: "--env-file alone", argv: ["--env-file"], match: /--env-file requires/ },
    { name: "--metadata alone", argv: ["--metadata"], match: /--metadata requires/ },
    {
      name: "--selectable-fields alone",
      argv: ["--selectable-fields"],
      match: /--selectable-fields requires/,
    },
    {
      name: "--tool-prefix alone",
      argv: ["--tool-prefix"],
      match: /--tool-prefix requires/,
    },
  ])("throws when $name lacks an argument", ({ argv, match }) => {
    expect(() => parseArgs(argv)).toThrow(match);
  });

  it.each([
    {
      name: "missing --env-file",
      argv: ["--metadata", "m", "--selectable-fields", "s"],
      match: /--env-file is required/,
    },
    {
      name: "missing --metadata",
      argv: ["--env-file", "e", "--selectable-fields", "s"],
      match: /--metadata is required/,
    },
    {
      name: "missing --selectable-fields",
      argv: ["--env-file", "e", "--metadata", "m"],
      match: /--selectable-fields is required/,
    },
    { name: "completely empty argv", argv: [], match: /--env-file is required/ },
  ])("throws when $name", ({ argv, match }) => {
    expect(() => parseArgs(argv)).toThrow(match);
  });
});
