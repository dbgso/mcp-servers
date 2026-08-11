/**
 * Tests for load-config.ts.
 *
 * Three layers exercised:
 *   - Pure path normalisation helpers (`expandHome`, `toImportSpecifier`,
 *     `toFsPath`).
 *   - JSON code path (`.json` extension): file is parsed directly, must
 *     contain the metadata / selectableFields map at the top level.
 *   - Dynamic-import code path (`.ts` / `.js` extensions): module must
 *     expose the named export (or default-wrapped equivalent).
 *
 * The JSON path is exercised via injected `jsonReader` and against a real
 * on-disk fixture; the dynamic-import path is exercised via injected
 * `importer` and against the existing TS fixture.
 */
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expandHome,
  loadMetadata,
  loadSelectableFields,
  toFsPath,
  toImportSpecifier,
} from "../load-config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const metaTsFixturePath = path.join(fixturesDir, "sample-metadata.ts");
const selTsFixturePath = path.join(fixturesDir, "sample-selectable-fields.ts");

describe("expandHome", () => {
  it.each([
    { input: "~", expected: homedir() },
    { input: "~/foo/bar", expected: path.join(homedir(), "foo/bar") },
    { input: "/abs/path", expected: "/abs/path" },
    { input: "./rel/path", expected: "./rel/path" },
    { input: "no-tilde", expected: "no-tilde" },
  ])("$input → matching path", ({ input, expected }) => {
    expect(expandHome(input)).toBe(expected);
  });
});

describe("toImportSpecifier", () => {
  it("passes file:// URLs through unchanged", () => {
    const url = "file:///abs/path/to/foo.ts";
    expect(toImportSpecifier(url)).toBe(url);
  });

  it("converts absolute paths to file:// URLs", () => {
    expect(toImportSpecifier("/abs/path/foo.ts")).toBe(
      pathToFileURL("/abs/path/foo.ts").href,
    );
  });

  it("resolves relative paths against process.cwd()", () => {
    const out = toImportSpecifier("./rel.ts");
    expect(out.startsWith("file://")).toBe(true);
    expect(out.endsWith("/rel.ts")).toBe(true);
  });

  it("expands ~ before resolving", () => {
    const out = toImportSpecifier("~/foo.ts");
    expect(out).toBe(pathToFileURL(path.join(homedir(), "foo.ts")).href);
  });
});

describe("toFsPath", () => {
  it.each([
    {
      desc: "passes absolute paths through",
      input: "/abs/foo.json",
      expected: "/abs/foo.json",
    },
    {
      desc: "expands ~",
      input: "~/foo.json",
      expected: path.join(homedir(), "foo.json"),
    },
    {
      desc: "resolves relative paths against cwd",
      input: "./rel.json",
      expected: path.resolve(process.cwd(), "./rel.json"),
    },
  ])("$desc", ({ input, expected }) => {
    expect(toFsPath(input)).toBe(expected);
  });

  it("converts file:// URLs back to a plain path for fs.readFile", () => {
    const url = pathToFileURL("/abs/foo.json").href;
    expect(toFsPath(url)).toBe("/abs/foo.json");
  });
});

describe("loadMetadata / loadSelectableFields — TS / JS module path", () => {
  it.each([
    {
      name: "loadMetadata named export",
      load: loadMetadata,
      mod: { tableMetadata: { users: { tableName: "users", primaryKey: ["id"], fields: {} } } },
      expectedKeys: ["users"],
    },
    {
      name: "loadSelectableFields named export",
      load: loadSelectableFields,
      mod: { selectableFields: { users: { fields: { id: {} } } } },
      expectedKeys: ["users"],
    },
    {
      name: "loadMetadata via default export wrapper",
      load: loadMetadata,
      mod: {
        default: {
          tableMetadata: { teams: { tableName: "teams", primaryKey: ["id"], fields: {} } },
        },
      },
      expectedKeys: ["teams"],
    },
    {
      name: "loadSelectableFields via default export wrapper",
      load: loadSelectableFields,
      mod: { default: { selectableFields: { teams: { fields: { id: {} } } } } },
      expectedKeys: ["teams"],
    },
  ])("$name", async ({ load, mod, expectedKeys }) => {
    const importer = async (): Promise<unknown> => mod;
    const out = (await load({ filePath: "/tmp/fake.ts", importer })) as Record<
      string,
      unknown
    >;
    expect(Object.keys(out)).toEqual(expectedKeys);
  });

  it.each([
    {
      name: "loadMetadata throws when export is missing",
      load: loadMetadata,
      mod: { somethingElse: 1 },
      match: /does not export 'tableMetadata'/,
    },
    {
      name: "loadSelectableFields throws when export is missing",
      load: loadSelectableFields,
      mod: { somethingElse: 1 },
      match: /does not export 'selectableFields'/,
    },
    {
      name: "loadMetadata throws when module is null",
      load: loadMetadata,
      mod: null,
      match: /did not return an object/,
    },
    {
      name: "loadSelectableFields throws when module is non-object",
      load: loadSelectableFields,
      mod: "not-an-object",
      match: /did not return an object/,
    },
  ])("$name", async ({ load, mod, match }) => {
    const importer = async (): Promise<unknown> => mod;
    await expect(load({ filePath: "/tmp/fake.ts", importer })).rejects.toThrow(
      match,
    );
  });
});

// Real on-disk import — guards against breakage in the path → file URL
// pipeline (vitest can resolve TS files directly via its loader).
describe("loadMetadata / loadSelectableFields against on-disk TS fixtures", () => {
  it("loads sample-metadata.ts via real import()", async () => {
    const meta = await loadMetadata({ filePath: metaTsFixturePath });
    expect(meta.users.primaryKey).toEqual(["id"]);
    expect(meta.users.fields.id?.type).toBe("string");
  });

  it("loads sample-selectable-fields.ts via real import()", async () => {
    const sel = await loadSelectableFields({ filePath: selTsFixturePath });
    expect(sel.users.fields.name?.select).toBe("redact");
  });

  it("accepts a file:// URL specifier directly for TS modules", async () => {
    const url = pathToFileURL(metaTsFixturePath).href;
    const meta = await loadMetadata({ filePath: url });
    expect(meta.users.tableName).toBe("users");
  });
});

describe("loadMetadata / loadSelectableFields — JSON path (preferred)", () => {
  it.each([
    {
      name: "loadMetadata reads the map verbatim from JSON",
      load: loadMetadata,
      payload: {
        users: {
          tableName: "users",
          primaryKey: ["id"],
          fields: { id: { type: "string", nullable: false } },
        },
      },
      expectedKeys: ["users"],
    },
    {
      name: "loadSelectableFields reads the map verbatim from JSON",
      load: loadSelectableFields,
      payload: { teams: { fields: { id: {} } } },
      expectedKeys: ["teams"],
    },
  ])("$name", async ({ load, payload, expectedKeys }) => {
    const jsonReader = async (): Promise<string> => JSON.stringify(payload);
    const out = (await load({
      filePath: "/tmp/fake.json",
      jsonReader,
    })) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(expectedKeys);
  });

  it("surfaces a useful error when the JSON file is malformed", async () => {
    const jsonReader = async (): Promise<string> => "{ not json";
    await expect(
      loadMetadata({ filePath: "/tmp/fake.json", jsonReader }),
    ).rejects.toThrow(/Failed to parse tableMetadata JSON/);
  });

  it("surfaces a useful error when the JSON file is unreadable", async () => {
    const jsonReader = async (): Promise<string> => {
      throw new Error("ENOENT");
    };
    await expect(
      loadSelectableFields({ filePath: "/tmp/fake.json", jsonReader }),
    ).rejects.toThrow(/Failed to read selectableFields/);
  });

  it("loads metadata + selectableFields from real on-disk JSON files", async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "load-config-"));
    try {
      const metaPath = path.join(tmpDir, "metadata.json");
      const selPath = path.join(tmpDir, "selectable-fields.json");
      await fsp.writeFile(
        metaPath,
        JSON.stringify({
          users: {
            tableName: "users",
            primaryKey: ["id"],
            fields: {
              id: { type: "string", nullable: false, nativeType: "text" },
              email: { type: "string", nullable: false, nativeType: "varchar" },
            },
          },
        }),
      );
      await fsp.writeFile(
        selPath,
        JSON.stringify({
          users: {
            fields: { id: {}, email: { pii: true, piiReason: "PII" } },
          },
        }),
      );
      const meta = await loadMetadata({ filePath: metaPath });
      const sel = await loadSelectableFields({ filePath: selPath });
      expect(meta.users.fields.id?.type).toBe("string");
      expect(sel.users.fields.email?.pii).toBe(true);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("loadMetadata — extension-driven dispatch", () => {
  let importerCalled: boolean;
  let jsonReaderCalled: boolean;

  beforeEach(() => {
    importerCalled = false;
    jsonReaderCalled = false;
  });

  afterEach(() => {
    // sanity guard so a leftover state doesn't bleed into other suites
    importerCalled = false;
    jsonReaderCalled = false;
  });

  it("uses jsonReader for .json extension and never the importer", async () => {
    await loadMetadata({
      filePath: "/tmp/x.json",
      jsonReader: async () => {
        jsonReaderCalled = true;
        return JSON.stringify({ users: { tableName: "users", primaryKey: [], fields: {} } });
      },
      importer: async () => {
        importerCalled = true;
        return {};
      },
    });
    expect(jsonReaderCalled).toBe(true);
    expect(importerCalled).toBe(false);
  });

  it("uses importer for .ts extension and never the jsonReader", async () => {
    await loadMetadata({
      filePath: "/tmp/x.ts",
      importer: async () => {
        importerCalled = true;
        return { tableMetadata: {} };
      },
      jsonReader: async () => {
        jsonReaderCalled = true;
        return "";
      },
    });
    expect(importerCalled).toBe(true);
    expect(jsonReaderCalled).toBe(false);
  });
});

describe("dynamic-import security warning", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => stderrSpy.mockRestore());

  it("emits a stderr warning when loading a non-JSON metadata path", async () => {
    await loadMetadata({
      filePath: "/tmp/fake.ts",
      importer: async () => ({ tableMetadata: {} }),
    });
    const warnings = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("dynamic import"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("/tmp/fake.ts");
    expect(warnings[0]).toContain("tableMetadata");
  });

  it("is silent when loading a .json metadata path", async () => {
    await loadMetadata({
      filePath: "/tmp/fake.json",
      jsonReader: async () =>
        JSON.stringify({ users: { tableName: "users", primaryKey: [], fields: {} } }),
    });
    const warnings = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("dynamic import"));
    expect(warnings).toHaveLength(0);
  });

  it("also warns for selectableFields non-JSON paths", async () => {
    await loadSelectableFields({
      filePath: "/tmp/fake.ts",
      importer: async () => ({ selectableFields: {} }),
    });
    const warnings = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("dynamic import"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("selectableFields");
  });
});
