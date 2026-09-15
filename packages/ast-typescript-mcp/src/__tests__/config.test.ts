/**
 * How the server is configured from its command line, and the two path
 * resolutions it does on its own.
 *
 * `config.ts` is read once at startup and decides which tsconfig the project
 * is built with -- so a flag that silently lands in the wrong place (an
 * extended option written into ts-morph's options, or the other way round)
 * changes every analysis afterwards. None of the parsing arms were run.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { parseArgs, findTsConfig, resolveToSourcePath } from "../config.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ast-ts-config-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("the defaults", () => {
  it("apply when nothing is passed", () => {
    const config = parseArgs([]);

    expect(config.projectOptions.skipAddingFilesFromTsConfig).toBe(true);
    expect(config.extendedOptions.resolveToSource).toBe(true);
  });

  it("survive an argument that is not a flag", () => {
    const config = parseArgs(["positional", "--", "also-not-a-flag"]);

    expect(config.extendedOptions.resolveToSource).toBe(true);
  });
});

describe("a flag", () => {
  it("with no value is true", () => {
    expect(parseArgs(["--resolveToSource"]).extendedOptions.resolveToSource).toBe(true);
  });

  it("prefixed with no- is false", () => {
    expect(parseArgs(["--no-resolveToSource"]).extendedOptions.resolveToSource).toBe(false);
  });

  it("written in kebab-case reaches the camelCase option", () => {
    // `--ts-config-file-path` and `--tsConfigFilePath` have to be the same
    // flag, or a caller who guesses the other spelling is silently ignored.
    const config = parseArgs(["--ts-config-file-path=/tmp/tsconfig.json"]);

    expect(config.projectOptions.tsConfigFilePath).toBe("/tmp/tsconfig.json");
  });

  it.each([
    { raw: "true", expected: true },
    { raw: "false", expected: false },
    { raw: "42", expected: 42 },
    { raw: "1.5", expected: 1.5 },
    { raw: "plain", expected: "plain" },
  ])("with the value $raw becomes $expected", ({ raw, expected }) => {
    const config = parseArgs([`--someOption=${raw}`]);

    expect((config.projectOptions as Record<string, unknown>).someOption).toBe(expected);
  });

  it("with a JSON value is parsed as JSON", () => {
    const config = parseArgs(['--compilerOptions={"strict":true}']);

    expect(config.projectOptions.compilerOptions).toEqual({ strict: true });
  });

  it("with a broken JSON value is kept as the string it is", () => {
    // Better the raw text reaches ts-morph and fails loudly than a silent
    // `undefined` that reads as "not configured".
    const config = parseArgs(["--compilerOptions={not json"]);

    expect(config.projectOptions.compilerOptions).toBe("{not json");
  });

  it("goes to ts-morph's options unless it is one of ours", () => {
    const config = parseArgs(["--resolveToSource=false", "--skipFileDependencyResolution=true"]);

    expect(config.extendedOptions.resolveToSource).toBe(false);
    expect(config.projectOptions.skipFileDependencyResolution).toBe(true);
    expect("resolveToSource" in config.projectOptions).toBe(false);
  });
});

describe("--config", () => {
  it("merges a JSON file over the defaults", async () => {
    const configPath = join(dir, "ast.json");
    await writeFile(
      configPath,
      JSON.stringify({
        projectOptions: { tsConfigFilePath: "/from/file.json" },
        extendedOptions: { resolveToSource: false },
      }),
      "utf-8"
    );

    const config = parseArgs([`--config=${configPath}`]);

    expect(config.projectOptions.tsConfigFilePath).toBe("/from/file.json");
    expect(config.extendedOptions.resolveToSource).toBe(false);
  });

  it("keeps the defaults, and says so, when the file cannot be read", async () => {
    // Starting with defaults is better than refusing to start, but it must
    // not be silent: the caller asked for a configuration they are not
    // getting.
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const config = parseArgs([`--config=${join(dir, "absent.json")}`]);

    expect(config.extendedOptions.resolveToSource).toBe(true);
    expect(stderr.mock.calls[0]?.[0]).toContain("Failed to load config file");
  });

  it("is overridden by a flag that comes after it", async () => {
    const configPath = join(dir, "ast.json");
    await writeFile(
      configPath,
      JSON.stringify({ extendedOptions: { resolveToSource: false } }),
      "utf-8"
    );

    const config = parseArgs([`--config=${configPath}`, "--resolveToSource"]);

    expect(config.extendedOptions.resolveToSource).toBe(true);
  });
});

describe("finding a tsconfig", () => {
  it("walks up from the file until it meets one", async () => {
    await mkdir(join(dir, "src", "deep"), { recursive: true });
    const tsconfig = join(dir, "tsconfig.json");
    await writeFile(tsconfig, "{}", "utf-8");

    expect(findTsConfig(join(dir, "src", "deep", "file.ts"))).toBe(tsconfig);
  });

  it("prefers the nearest one", async () => {
    await mkdir(join(dir, "packages", "a"), { recursive: true });
    await writeFile(join(dir, "tsconfig.json"), "{}", "utf-8");
    const nearest = join(dir, "packages", "a", "tsconfig.json");
    await writeFile(nearest, "{}", "utf-8");

    expect(findTsConfig(join(dir, "packages", "a", "file.ts"))).toBe(nearest);
  });

  it("gives up rather than walking past the root", () => {
    // The loop has to end somewhere; `/` is where.
    expect(findTsConfig("/nonexistent-root-dir-12345/file.ts")).toBeUndefined();
  });
});

describe("resolving a declaration back to its source", () => {
  it.each(["dist", "build", "lib"])("maps %s/ to src/", async (outDir) => {
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, outDir), { recursive: true });
    await writeFile(join(dir, "src", "thing.ts"), "export const a = 1;\n", "utf-8");

    const resolved = resolveToSourcePath(join(dir, outDir, "thing.d.ts"));

    expect(resolved).toBe(join(dir, "src", "thing.ts"));
  });

  it("finds a .tsx source when there is no .ts", async () => {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "component.tsx"), "export const a = 1;\n", "utf-8");

    const resolved = resolveToSourcePath(join(dir, "dist", "component.d.ts"));

    expect(resolved).toBe(join(dir, "src", "component.tsx"));
  });

  it("returns nothing when the source is not where the pattern says", async () => {
    // A published package ships `dist/` with no `src/` beside it, which is
    // the ordinary case -- so this has to answer "no", not guess a path.
    expect(resolveToSourcePath(join(dir, "dist", "absent.d.ts"))).toBeNull();
  });

  it("returns nothing for a path with no build directory in it", () => {
    expect(resolveToSourcePath("/somewhere/types/thing.d.ts")).toBeNull();
  });
});
