import { describe, it, expect } from "vitest";
import { parseFlagArgs, type FlagSpec } from "../cli-args.js";

type Key = "envFile" | "metadata";
const specs: readonly FlagSpec<Key>[] = [
  { flag: "--env-file", key: "envFile" },
  { flag: "--metadata", key: "metadata" },
];

describe("parseFlagArgs", () => {
  it("reads each known flag's value and ignores the rest", () => {
    expect(
      parseFlagArgs({ argv: ["--other", "--env-file", "a.env", "x", "--metadata", "m.json"], specs }),
    ).toEqual({ envFile: "a.env", metadata: "m.json" });
  });

  it("returns an empty bag for no arguments", () => {
    expect(parseFlagArgs({ argv: [], specs })).toEqual({});
  });

  it("throws when a known flag has no value", () => {
    expect(() => parseFlagArgs({ argv: ["--metadata"], specs })).toThrow(
      "--metadata requires a path argument",
    );
  });

  it("throws for the first missing required flag", () => {
    expect(() =>
      parseFlagArgs({ argv: ["--env-file", "a"], specs, required: ["envFile", "metadata"] }),
    ).toThrow("--metadata is required");
  });

  it("names a required key with no spec as a flag", () => {
    expect(() =>
      parseFlagArgs({ argv: [], specs: [] as FlagSpec<Key>[], required: ["envFile"] }),
    ).toThrow("--envFile is required");
  });
});
