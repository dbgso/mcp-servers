import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultOutputDir, parseCli } from "../cli.js";

describe("parseCli", () => {
  it("defaults to a directory under the OS temp directory", () => {
    expect(parseCli({ argv: [] })).toEqual({ outputDir: path.join(os.tmpdir(), "report-mcp") });
    expect(defaultOutputDir()).toBe(path.join(os.tmpdir(), "report-mcp"));
  });

  it("resolves --output-dir against the working directory", () => {
    expect(parseCli({ argv: ["--output-dir", "out/reports"] })).toEqual({
      outputDir: path.resolve("out/reports"),
    });
  });

  it("refuses a flag it does not know", () => {
    expect(() => parseCli({ argv: ["--outdir", "x"] })).toThrow();
  });
});
