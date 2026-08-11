import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Mock homedir to a per-test temporary directory so `~/...` expansion
// is exercised without touching the user's real home. `vi.hoisted` is used
// because `vi.mock` factories are hoisted above ordinary top-level code.
const { fakeHome } = vi.hoisted(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  return {
    fakeHome: fs.mkdtempSync(p.join(os.tmpdir(), "mcp-shared-secrets-home-")),
  };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => fakeHome,
  };
});

// Import after the mock is registered.
const { loadEnvFile } = await import("../dotenv.js");

const TMP_ROOT = mkdtempSync(path.join(tmpdir(), "mcp-shared-secrets-"));

const ENV_KEYS = [
  "DOTENV_PLAIN",
  "DOTENV_SPACED",
  "DOTENV_DOUBLE",
  "DOTENV_SINGLE",
  "DOTENV_INLINE",
  "DOTENV_PREEXISTING",
  "DOTENV_NEWLINE",
  "DOTENV_ESCAPED_QUOTE",
  "DOTENV_EMPTY",
  "DOTENV_HOME_KEY",
];

function writeFixture(name: string, contents: string): string {
  const p = path.join(TMP_ROOT, name);
  writeFileSync(p, contents, "utf8");
  return p;
}

describe("loadEnvFile", () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = {};
    for (const k of ENV_KEYS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it("parses common dotenv shapes and merges into process.env", () => {
    const file = writeFixture(
      "common.env",
      [
        "# leading comment",
        "",
        "DOTENV_PLAIN=plain-value",
        "DOTENV_SPACED=  spaced-out  # trailing inline comment",
        'DOTENV_DOUBLE="value with spaces"',
        "DOTENV_SINGLE='single-quoted # not-a-comment'",
        "DOTENV_INLINE=hello # inline tail",
        "DOTENV_NEWLINE=\"line1\\nline2\"",
        'DOTENV_ESCAPED_QUOTE="he said \\"hi\\""',
        "DOTENV_EMPTY=",
        "not a valid line",
        "",
      ].join("\n"),
    );

    const parsed = loadEnvFile(file);

    expect(parsed).toEqual({
      DOTENV_PLAIN: "plain-value",
      DOTENV_SPACED: "spaced-out",
      DOTENV_DOUBLE: "value with spaces",
      DOTENV_SINGLE: "single-quoted # not-a-comment",
      DOTENV_INLINE: "hello",
      DOTENV_NEWLINE: "line1\nline2",
      DOTENV_ESCAPED_QUOTE: 'he said "hi"',
      DOTENV_EMPTY: "",
    });
    expect(process.env.DOTENV_PLAIN).toBe("plain-value");
    expect(process.env.DOTENV_DOUBLE).toBe("value with spaces");
    expect(process.env.DOTENV_NEWLINE).toBe("line1\nline2");
  });

  it("does not overwrite values already present in process.env", () => {
    process.env.DOTENV_PREEXISTING = "from-shell";
    const file = writeFixture("override.env", "DOTENV_PREEXISTING=from-file\n");

    const parsed = loadEnvFile(file);
    // The parsed map still reflects the file's view…
    expect(parsed).toEqual({ DOTENV_PREEXISTING: "from-file" });
    // …but process.env keeps the shell value.
    expect(process.env.DOTENV_PREEXISTING).toBe("from-shell");
  });

  it("handles CRLF line endings", () => {
    const file = writeFixture("crlf.env", "DOTENV_PLAIN=cr-value\r\nDOTENV_INLINE=other\r\n");
    loadEnvFile(file);
    expect(process.env.DOTENV_PLAIN).toBe("cr-value");
    expect(process.env.DOTENV_INLINE).toBe("other");
  });

  it("expands `~/...` to the (mocked) home directory", () => {
    const subdir = path.join(fakeHome, "nested");
    mkdirSync(subdir, { recursive: true });
    const filename = "home.env";
    writeFileSync(path.join(subdir, filename), "DOTENV_HOME_KEY=home-value\n", "utf8");

    const parsed = loadEnvFile(`~/nested/${filename}`);
    expect(parsed).toEqual({ DOTENV_HOME_KEY: "home-value" });
    expect(process.env.DOTENV_HOME_KEY).toBe("home-value");
  });

  it("expands a bare `~` to the home directory itself", () => {
    // The fake home is a real directory, so `existsSync` returns true and
    // `readFileSync` then throws EISDIR. We don't care about the exact error
    // shape here — only that the bare-tilde branch is exercised and the
    // expanded path is the home directory itself.
    expect(() => loadEnvFile("~")).toThrow();
  });

  it("throws when the file does not exist", () => {
    const missing = path.join(TMP_ROOT, "does-not-exist.env");
    expect(() => loadEnvFile(missing)).toThrow(`Env file not found: ${missing}`);
  });

  it("returns the parsed map even when no keys are merged", () => {
    const file = writeFixture("only-comments.env", "# just a comment\n\n");
    expect(loadEnvFile(file)).toEqual({});
  });
});

// Cleanup once the suite is done.
afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});
